// Converts trusted declarative actions into event listeners. No attribute
// JavaScript and no eval/Function execution is used.
(function bindDashboardActions() {
    const directFunctions = new Set([
        'closeConfirmModal', 'confirmDiscardChanges', 'copyCallbackUrl',
        'copyCloudWebhookUrl', 'deleteCustomModelFromModal',
        'deleteCustomModelFromSettings', 'dismissUnsavedConfirmation',
        'handleDrawerCancelBtn', 'handleDrawerCloseBtn', 'handleDrawerSaveBtn',
        'hideAICardCustomModelModal', 'hideAIModelModal', 'hideCustomModelModal',
        'hideDeleteCustomModelModal', 'logoutAdmin', 'logoutWhatsApp',
        'saveAICardCustomModel', 'saveAIModelTaskConfig', 'saveCustomModelUI',
        'saveWhatsAppCloudConfig', 'showAddCustomModelDialog',
        'onAIModelProviderChange', 'toggleWhatsAppProviderUI'
    ]);
    const argumentFunctions = new Set([
        'openSettingsDrawer', 'showSection', 'togglePasswordVisibility'
    ]);

    function invoke(expression, element, event) {
        const direct = expression.match(/^([A-Za-z_$][\w$]*)\(\)$/);
        if (direct && directFunctions.has(direct[1]) && typeof window[direct[1]] === 'function') {
            return window[direct[1]]();
        }
        const withArgument = expression.match(/^([A-Za-z_$][\w$]*)\('([A-Za-z0-9_-]+)'\)$/);
        if (
            withArgument &&
            argumentFunctions.has(withArgument[1]) &&
            typeof window[withArgument[1]] === 'function'
        ) {
            return window[withArgument[1]](withArgument[2]);
        }
        if (expression === 'handleBackdropClick(event)' && typeof window.handleBackdropClick === 'function') {
            return window.handleBackdropClick(event);
        }
        if (expression === 'window.Dashboard.aiUsage.refreshAll(true)') {
            return window.Dashboard.aiUsage.refreshAll(true);
        }
        if (expression === 'window.Dashboard.rag.clearPlayground()') {
            return window.Dashboard.rag.clearPlayground();
        }
        if (expression === 'window.Dashboard.rag.copyPlaygroundAnswer()') {
            return window.Dashboard.rag.copyPlaygroundAnswer();
        }

        const panel = expression.match(/^window\.Dashboard\.rag\.switchPanelTab\('([a-z]+)'\)$/);
        if (panel) return window.Dashboard.rag.switchPanelTab(panel[1]);

        const clickInput = expression.match(/^document\.getElementById\('([A-Za-z0-9_-]+)'\)\.click\(\)$/);
        if (clickInput) return document.getElementById(clickInput[1])?.click();

        const addClass = expression.match(
            /^document\.getElementById\('([A-Za-z0-9_-]+)'\)\.classList\.add\('([A-Za-z0-9_-]+)'\)$/
        );
        if (addClass) return document.getElementById(addClass[1])?.classList.add(addClass[2]);

        const toggleAdvanced = expression.match(
            /^document\.getElementById\('([A-Za-z0-9_-]+)'\)\.classList\.toggle\('hidden'\); this\.querySelector\('\.arrow'\)\.classList\.toggle\('rotate-180'\)$/
        );
        if (toggleAdvanced) {
            document.getElementById(toggleAdvanced[1])?.classList.toggle('hidden');
            element.querySelector('.arrow')?.classList.toggle('rotate-180');
            return;
        }
        if (
            expression ===
            "document.getElementById('rag-doc-details-panel').classList.add('-translate-x-full'); setTimeout(()=>document.getElementById('rag-doc-details-panel').classList.add('hidden'), 300)"
        ) {
            const details = document.getElementById('rag-doc-details-panel');
            details?.classList.add('-translate-x-full');
            setTimeout(() => details?.classList.add('hidden'), 300);
            return;
        }
        console.error('[UI Security] Refused unknown declarative action.');
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-legacy-click]').forEach(element => {
            const action = element.dataset.legacyClick;
            element.removeAttribute('data-legacy-click');
            element.addEventListener('click', event => invoke(action, element, event));
        });
        document.querySelectorAll('[data-legacy-change]').forEach(element => {
            const action = element.dataset.legacyChange;
            element.removeAttribute('data-legacy-change');
            element.addEventListener('change', event => invoke(action, element, event));
        });
    });
})();
