import { e2e } from '../utils';
const DASHBOARD_ID = 'ed155665';

describe('Annotations filtering', () => {
  beforeEach(() => {
    e2e.flows.login(e2e.env('USERNAME'), e2e.env('PASSWORD'));
  });

  it('Tests switching filter type updates the UI accordingly', () => {
    e2e.flows.openDashboard({ uid: DASHBOARD_ID });

    e2e.components.PageToolbar.item('Dashboard settings').click();
    e2e.components.Tab.title('Annotations').click();
    cy.contains('New query').click();
    e2e.pages.Dashboard.Settings.Annotations.Settings.name().clear().type('Red - Panel two');

    e2e.pages.Dashboard.Settings.Annotations.NewAnnotation.showInLabel()
      .should('be.visible')
      .within(() => {
        // All panels
        e2e.components.Annotations.annotationsTypeInput().click({ force: true }).type('All panels{enter}');
        e2e.components.Annotations.annotationsChoosePanelInput().should('not.exist');

        // All panels except
        e2e.components.Annotations.annotationsTypeInput().click({ force: true }).type('All panels except{enter}');
        e2e.components.Annotations.annotationsChoosePanelInput().should('be.visible');

        // Selected panels
        e2e.components.Annotations.annotationsTypeInput().click({ force: true }).type('Selected panels{enter}');
        e2e.components.Annotations.annotationsChoosePanelInput()
          .should('be.visible')
          .click({ force: true })
          .type('Panel two{enter}');
      });

    e2e.pages.Dashboard.Settings.Annotations.NewAnnotation.previewInDashboard().click({ force: true });

    e2e.pages.Dashboard.SubMenu.Annotations.annotationsWrapper()
      .should('be.visible')
      .within(() => {
        e2e.pages.Dashboard.SubMenu.Annotations.annotationLabel('Red - Panel two').should('be.visible');
        e2e.pages.Dashboard.SubMenu.Annotations.annotationToggle('Red - Panel two')
          .should('be.checked')
          .uncheck({ force: true })
          .should('not.be.checked')
          .check({ force: true });

        e2e.pages.Dashboard.SubMenu.Annotations.annotationLabel('Red, only panel 1').should('be.visible');
        e2e.pages.Dashboard.SubMenu.Annotations.annotationToggle('Red, only panel 1').should('be.checked');
      });

    cy.wait(3000);

    e2e.components.Panels.Panel.title('Panel one')
      .should('exist')
      .within(() => {
        e2e.pages.Dashboard.Annotations.marker().should('exist').should('have.length', 4);
      });
  });
});
