// Unified, accessible product feedback for confirmations and non-blocking notices.
window.Dashboard = window.Dashboard || {};

window.Dashboard.feedback = {
    activeResolve: null,
    returnFocusTo: null,

    notify(message, type) {
        const safeMessage = window.Dashboard.utils.userFacingError(message);
        const resolvedType = type || (/^(?:تم|اكتمل|نجح)/.test(safeMessage) ? 'success' : 'error');
        window.Dashboard.settings.showToast(safeMessage, resolvedType);
    },

    confirm(options = {}) {
        const modal = document.getElementById('ux-confirm-dialog');
        const title = document.getElementById('ux-confirm-title');
        const description = document.getElementById('ux-confirm-description');
        const accept = document.getElementById('ux-confirm-accept');
        const cancel = document.getElementById('ux-confirm-cancel');
        if (!modal || !title || !description || !accept || !cancel) return Promise.resolve(false);

        if (this.activeResolve) this.finish(false);
        this.returnFocusTo = document.activeElement;
        title.textContent = options.title || 'تأكيد الإجراء';
        description.textContent = options.description || 'راجع تفاصيل الإجراء قبل المتابعة.';
        accept.textContent = options.confirmLabel || 'متابعة';
        cancel.textContent = options.cancelLabel || 'إلغاء';
        accept.className = `ux-dialog-primary ${options.destructive ? 'is-destructive' : ''}`;
        modal.classList.remove('hidden');
        document.body.classList.add('ux-dialog-open');

        return new Promise(resolve => {
            this.activeResolve = resolve;
            accept.onclick = () => this.finish(true);
            cancel.onclick = () => this.finish(false);
            requestAnimationFrame(() => (options.destructive ? cancel : accept).focus());
        });
    },

    setLoading(isLoading, label = 'جاري التنفيذ…') {
        const accept = document.getElementById('ux-confirm-accept');
        const cancel = document.getElementById('ux-confirm-cancel');
        if (!accept || !cancel) return;
        if (!accept.dataset.label) accept.dataset.label = accept.textContent;
        accept.disabled = isLoading;
        cancel.disabled = isLoading;
        accept.setAttribute('aria-busy', String(isLoading));
        accept.textContent = isLoading ? label : accept.dataset.label;
        if (!isLoading) delete accept.dataset.label;
    },

    finish(result) {
        const modal = document.getElementById('ux-confirm-dialog');
        if (!modal || modal.classList.contains('hidden')) return;
        const resolve = this.activeResolve;
        const returnTarget = this.returnFocusTo;
        this.setLoading(false);
        this.activeResolve = null;
        this.returnFocusTo = null;
        modal.classList.add('hidden');
        document.body.classList.remove('ux-dialog-open');
        if (returnTarget && typeof returnTarget.focus === 'function') returnTarget.focus();
        if (resolve) resolve(Boolean(result));
    },

    handleKeydown(event) {
        const modal = document.getElementById('ux-confirm-dialog');
        if (!modal || modal.classList.contains('hidden')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            this.finish(false);
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...modal.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
};

document.addEventListener('keydown', event => window.Dashboard.feedback.handleKeydown(event));
