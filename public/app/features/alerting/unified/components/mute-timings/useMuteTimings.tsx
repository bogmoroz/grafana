import { useEffect } from 'react';

import { alertmanagerApi } from 'app/features/alerting/unified/api/alertmanagerApi';
import { timeIntervalsApi } from 'app/features/alerting/unified/api/timeIntervalsApi';
import { mergeTimeIntervals } from 'app/features/alerting/unified/components/mute-timings/util';
import {
  ComGithubGrafanaGrafanaPkgApisAlertingNotificationsV0Alpha1TimeInterval,
  IoK8SApimachineryPkgApisMetaV1ObjectMeta,
} from 'app/features/alerting/unified/openapi/timeIntervalsApi.gen';
import { BaseAlertmanagerArgs, Skippable } from 'app/features/alerting/unified/types/hooks';
import { PROVENANCE_NONE } from 'app/features/alerting/unified/utils/k8s/constants';
import {
  encodeFieldSelector,
  isK8sEntityProvisioned,
  shouldUseK8sApi,
} from 'app/features/alerting/unified/utils/k8s/utils';
import { MuteTimeInterval } from 'app/plugins/datasource/alertmanager/types';

import { getAPINamespace } from '../../../../../api/utils';
import { useAsync } from '../../hooks/useAsync';
import { useProduceNewAlertmanagerConfiguration } from '../../hooks/useProduceNewAlertmanagerConfig';
import {
  addMuteTimingAction,
  deleteMuteTimingAction,
  updateMuteTimingAction,
} from '../../reducers/alertmanager/muteTimings';

const { useLazyGetAlertmanagerConfigurationQuery } = alertmanagerApi;
const {
  useLazyListNamespacedTimeIntervalQuery,
  useCreateNamespacedTimeIntervalMutation,
  useReplaceNamespacedTimeIntervalMutation,
  useDeleteNamespacedTimeIntervalMutation,
} = timeIntervalsApi;

/**
 * Alertmanager mute time interval, with optional additional metadata
 * (returned in the case of K8S API implementation)
 * */
export type MuteTiming = MuteTimeInterval & {
  id: string;
  metadata?: IoK8SApimachineryPkgApisMetaV1ObjectMeta;
};

/** Alias for generated kuberenetes Alerting API Server type */
type TimeIntervalV0Alpha1 = ComGithubGrafanaGrafanaPkgApisAlertingNotificationsV0Alpha1TimeInterval;

/** Parse kubernetes API response into a Mute Timing */
const parseK8sTimeInterval: (item: TimeIntervalV0Alpha1) => MuteTiming = (item) => {
  const { metadata, spec } = item;
  return {
    ...spec,
    id: spec.name,
    metadata,
    provisioned: isK8sEntityProvisioned(item),
  };
};

/** Parse Alertmanager time interval response into a Mute Timing */
const parseAmTimeInterval: (interval: MuteTimeInterval, provenance: string) => MuteTiming = (interval, provenance) => {
  return {
    ...interval,
    id: interval.name,
    provisioned: Boolean(provenance && provenance !== PROVENANCE_NONE),
  };
};

const useAlertmanagerIntervals = () =>
  useLazyGetAlertmanagerConfigurationQuery({
    selectFromResult: ({ data, ...rest }) => {
      if (!data) {
        return { data, ...rest };
      }
      const { alertmanager_config } = data;
      const muteTimingsProvenances = alertmanager_config.muteTimeProvenances ?? {};
      const intervals = mergeTimeIntervals(alertmanager_config);
      const timeIntervals = intervals.map((interval) =>
        parseAmTimeInterval(interval, muteTimingsProvenances[interval.name])
      );

      return {
        data: timeIntervals,
        ...rest,
      };
    },
  });

const useGrafanaAlertmanagerIntervals = () =>
  useLazyListNamespacedTimeIntervalQuery({
    selectFromResult: ({ data, ...rest }) => {
      return {
        data: data?.items.map((item) => parseK8sTimeInterval(item)),
        ...rest,
      };
    },
  });

/**
 * Depending on alertmanager source, fetches mute timings.
 *
 * If the alertmanager source is Grafana, and `alertingApiServer` feature toggle is enabled,
 * fetches time intervals from k8s API.
 *
 * Otherwise, fetches and parses from the alertmanager config API
 */
export const useMuteTimings = ({ alertmanager, skip }: BaseAlertmanagerArgs & Skippable) => {
  const useK8sApi = shouldUseK8sApi(alertmanager);

  const [getGrafanaTimeIntervals, intervalsResponse] = useGrafanaAlertmanagerIntervals();
  const [getAlertmanagerTimeIntervals, configApiResponse] = useAlertmanagerIntervals();

  useEffect(() => {
    if (skip) {
      return;
    }
    if (useK8sApi) {
      const namespace = getAPINamespace();
      getGrafanaTimeIntervals({ namespace });
    } else {
      getAlertmanagerTimeIntervals(alertmanager);
    }
  }, [alertmanager, getAlertmanagerTimeIntervals, getGrafanaTimeIntervals, skip, useK8sApi]);
  return useK8sApi ? intervalsResponse : configApiResponse;
};

type CreateUpdateMuteTimingArgs = { interval: MuteTimeInterval };

/**
 * Create a new mute timing.
 *
 * If the alertmanager source is Grafana, and `alertingApiServer` feature toggle is enabled,
 * fetches time intervals from k8s API.
 *
 * Otherwise, creates the new timing in `time_intervals` via AM config API
 */
export const useCreateMuteTiming = ({ alertmanager }: BaseAlertmanagerArgs) => {
  const useK8sApi = shouldUseK8sApi(alertmanager);

  const [createGrafanaTimeInterval] = useCreateNamespacedTimeIntervalMutation();
  const [updateConfiguration] = useProduceNewAlertmanagerConfiguration();

  const addToK8sAPI = useAsync(({ interval }: CreateUpdateMuteTimingArgs) => {
    const namespace = getAPINamespace();

    return createGrafanaTimeInterval({
      namespace,
      comGithubGrafanaGrafanaPkgApisAlertingNotificationsV0Alpha1TimeInterval: { metadata: {}, spec: interval },
    }).unwrap();
  });

  const addToAlertmanagerConfiguration = useAsync(({ interval }: CreateUpdateMuteTimingArgs) => {
    const action = addMuteTimingAction({ interval });
    return updateConfiguration(action);
  });

  return useK8sApi ? addToK8sAPI : addToAlertmanagerConfiguration;
};

/**
 * Get an individual time interval, either from the k8s API,
 * or by finding it in the alertmanager config
 */
export const useGetMuteTiming = ({ alertmanager, name: nameToFind }: BaseAlertmanagerArgs & { name: string }) => {
  const useK8sApi = shouldUseK8sApi(alertmanager);

  const [getGrafanaTimeInterval, k8sResponse] = useLazyListNamespacedTimeIntervalQuery({
    selectFromResult: ({ data, ...rest }) => {
      if (!data) {
        return { data, ...rest };
      }

      if (data.items.length === 0) {
        return { ...rest, data: undefined, isError: true };
      }

      return {
        data: parseK8sTimeInterval(data.items[0]),
        ...rest,
      };
    },
  });

  const [getAlertmanagerTimeInterval, amConfigApiResponse] = useLazyGetAlertmanagerConfigurationQuery({
    selectFromResult: ({ data, ...rest }) => {
      if (!data) {
        return { data, ...rest };
      }
      const alertmanager_config = data?.alertmanager_config ?? {};
      const timeIntervals = mergeTimeIntervals(alertmanager_config);
      const timing = timeIntervals.find(({ name }) => name === nameToFind);
      if (timing) {
        const muteTimingsProvenances = alertmanager_config?.muteTimeProvenances ?? {};

        return {
          data: parseAmTimeInterval(timing, muteTimingsProvenances[timing.name]),
          ...rest,
        };
      }
      return { ...rest, data: undefined, isError: true };
    },
  });

  useEffect(() => {
    if (useK8sApi) {
      const namespace = getAPINamespace();
      const entityName = encodeFieldSelector(nameToFind);
      getGrafanaTimeInterval({ namespace, fieldSelector: `spec.name=${entityName}` }, true);
    } else {
      getAlertmanagerTimeInterval(alertmanager, true);
    }
  }, [alertmanager, getAlertmanagerTimeInterval, getGrafanaTimeInterval, nameToFind, useK8sApi]);

  return useK8sApi ? k8sResponse : amConfigApiResponse;
};

/**
 * Updates an existing mute timing.
 *
 * If the alertmanager source is Grafana, and `alertingApiServer` feature toggle is enabled,
 * uses the k8s API. At the time of writing, the name of the timing cannot be changed via this API
 *
 * Otherwise, updates the timing via AM config API, and also ensures any referenced routes are updated
 */
export const useUpdateMuteTiming = ({ alertmanager }: BaseAlertmanagerArgs) => {
  const useK8sApi = shouldUseK8sApi(alertmanager);

  const [replaceGrafanaTimeInterval] = useReplaceNamespacedTimeIntervalMutation();
  const [updateConfiguration] = useProduceNewAlertmanagerConfiguration();

  const updateToK8sAPI = useAsync(
    async ({ interval, originalName }: CreateUpdateMuteTimingArgs & { originalName: string }) => {
      const namespace = getAPINamespace();

      return replaceGrafanaTimeInterval({
        name: originalName,
        namespace,
        comGithubGrafanaGrafanaPkgApisAlertingNotificationsV0Alpha1TimeInterval: {
          spec: interval,
          metadata: { name: originalName },
        },
      }).unwrap();
    }
  );

  const updateToAlertmanagerConfiguration = useAsync(
    async ({ interval, originalName }: CreateUpdateMuteTimingArgs & { originalName: string }) => {
      const action = updateMuteTimingAction({ interval, originalName });
      return updateConfiguration(action);
    }
  );

  return useK8sApi ? updateToK8sAPI : updateToAlertmanagerConfiguration;
};

/**
 * Delete a mute timing interval
 */
type DeleteMuteTimingArgs = { name: string };
export const useDeleteMuteTiming = ({ alertmanager }: BaseAlertmanagerArgs) => {
  const useK8sApi = shouldUseK8sApi(alertmanager);

  const [updateConfiguration, _updateConfigurationRequestState] = useProduceNewAlertmanagerConfiguration();
  const [deleteGrafanaTimeInterval] = useDeleteNamespacedTimeIntervalMutation();

  const deleteFromAlertmanagerAPI = useAsync(async ({ name }: DeleteMuteTimingArgs) => {
    const action = deleteMuteTimingAction({ name });
    return updateConfiguration(action);
  });

  const deleteFromK8sAPI = useAsync(async ({ name }: DeleteMuteTimingArgs) => {
    const namespace = getAPINamespace();
    await deleteGrafanaTimeInterval({
      name,
      namespace,
      ioK8SApimachineryPkgApisMetaV1DeleteOptions: {},
    }).unwrap();
  });

  return useK8sApi ? deleteFromK8sAPI : deleteFromAlertmanagerAPI;
};

export const useValidateMuteTiming = ({ alertmanager }: BaseAlertmanagerArgs) => {
  const useK8sApi = shouldUseK8sApi(alertmanager);

  const [getIntervals] = useAlertmanagerIntervals();

  // If we're using the kubernetes API, then we let the API response handle the validation instead
  // as we don't expect to be able to fetch the intervals via the AM config
  if (useK8sApi) {
    return () => undefined;
  }

  return async (value: string, skipValidation?: boolean) => {
    if (skipValidation) {
      return;
    }
    return getIntervals(alertmanager)
      .unwrap()
      .then((config) => {
        const intervals = mergeTimeIntervals(config.alertmanager_config);
        const duplicatedInterval = Boolean(intervals?.find((interval) => interval.name === value));
        return duplicatedInterval ? `Mute timing already exists with name "${value}"` : undefined;
      });
  };
};
