# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

<panel flip="side" type="arrow"
    opupalign="center" 
    orient="vertical" 
    id="PanelUI-zen-gradient-generator" 
    position="bottomright topright" 
    mainview="true" 
    hidepopovertail="true"
    side="left">
  <panelmultiview id="PanelUI-zen-gradient-generator-multiview" mainViewId="PanelUI-zen-gradient-generator-view">
    <panelview id="PanelUI-zen-gradient-generator-view" class="PanelUI-subView zen-theme-picker" role="document" mainview-with-header="true" has-custom-header="true">
      <hbox class="zen-theme-picker-gradient">
        <hbox id="PanelUI-zen-gradient-generator-scheme">
          <button id="PanelUI-zen-gradient-generator-scheme-auto" class="no-squircles subviewbutton"/>
          <button id="PanelUI-zen-gradient-generator-scheme-light" class="no-squircles subviewbutton"/>
          <button id="PanelUI-zen-gradient-generator-scheme-dark" class="no-squircles subviewbutton"/> 
        </hbox>
        <hbox id="PanelUI-zen-gradient-generator-color-actions">
          <button id="PanelUI-zen-gradient-generator-color-remove" class="no-squircles subviewbutton" />
          <button id="PanelUI-zen-gradient-generator-color-add" class="no-squircles subviewbutton" />
          <button id="PanelUI-zen-gradient-generator-color-toggle-algo" class="no-squircles subviewbutton" />
        </hbox>
        <label data-l10n-id="zen-panel-ui-gradient-click-to-add" id="PanelUI-zen-gradient-generator-color-click-to-add"></label>
      </hbox>
      <hbox id="PanelUI-zen-gradient-generator-color-pages-wrapper">
        <toolbarbutton id="PanelUI-zen-gradient-generator-color-page-left" class="toolbarbutton-1" disabled="true" aria-label="Move to previous preset page" />
        <hbox id="PanelUI-zen-gradient-generator-color-pages"/>
        <toolbarbutton id="PanelUI-zen-gradient-generator-color-page-right" class="toolbarbutton-1" aria-label="Move to next preset page" />
      </hbox>
      <hbox id="PanelUI-zen-gradient-generator-controls">
        <hbox id="PanelUI-zen-gradient-colors-wrapper">
          <vbox flex="1" id="PanelUI-zen-gradient-opacity-wrapper">
            <box id="PanelUI-zen-gradient-slider-wave">
              <svg viewBox="0 0 224 44" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <defs>
                  <clipPath id="zen-intensity-progress-clip"><rect x="0" y="0" width="0" height="44"/></clipPath>
                </defs>
                <path class="zen-intensity-wave-base" fill="none" stroke-width="5" stroke-linecap="round"/>
                <rect class="zen-intensity-track" x="0" y="14" width="224" height="16" rx="8"/>
                <path class="zen-intensity-wave-progress" fill="none" stroke-width="5" stroke-linecap="round" clip-path="url(#zen-intensity-progress-clip)"/>
              </svg>
            </box>
            <html:div id="PanelUI-zen-gradient-intensity-thumb" aria-hidden="true"/>
            <html:input type="range" value="0.4" step="any" min="0" max="1" aria-label="Intensity"
              id="PanelUI-zen-gradient-generator-opacity"/>
          </vbox>
          <vbox id="PanelUI-zen-gradient-generator-texture-wrapper">
          </vbox>
        </hbox>
      </hbox>
      <vbox id="PanelUI-zen-gradient-generator-custom-colors">
        <vbox id="zen-theme-picker-color">
          <label data-l10n-id="zen-panel-ui-gradient-generator-custom-color"></label>
          <hbox>
            <html:input type="color" id="PanelUI-zen-gradient-generator-custom-input" />
            <html:input type="number" value="1" min="0" max="1" step="0.01" id="PanelUI-zen-gradient-generator-custom-opacity" />
            <toolbarbutton id="PanelUI-zen-gradient-generator-color-custom-add" class="subviewbutton">
              <image></image>
            </toolbarbutton>
          </hbox>
        </vbox>
        <vbox id="PanelUI-zen-gradient-generator-custom-list">
        </vbox>
      </vbox>
    </panelview>
  </panelmultiview>
</panel>
