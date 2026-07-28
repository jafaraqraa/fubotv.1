// Shared channel presentation policy. It contains visual semantics only; fetching,
// routing and message actions stay in the common chat modules.
window.Dashboard = window.Dashboard || {};

window.Dashboard.chatThemes = {
    themes: {
        whatsapp: {
            id: 'whatsapp',
            label: 'WhatsApp',
            accent: '#00a884',
            avatar: 'WA',
            statusLabel: 'متصل عبر WhatsApp',
            composerPlaceholder: 'اكتب رسالة',
            quickReaction: '👍'
        },
        telegram: {
            id: 'telegram',
            label: 'Telegram',
            accent: '#3390ec',
            avatar: 'TG',
            statusLabel: 'Telegram · متصل',
            composerPlaceholder: 'اكتب رسالة...',
            quickReaction: '👍'
        },
        messenger: {
            id: 'messenger',
            label: 'Messenger',
            accent: '#0084ff',
            avatar: 'M',
            statusLabel: 'نشط الآن على Messenger',
            composerPlaceholder: 'Aa',
            quickReaction: '👍'
        },
        instagram: {
            id: 'instagram',
            label: 'Instagram',
            accent: '#c13584',
            avatar: 'IG',
            statusLabel: 'نشط الآن',
            composerPlaceholder: 'مراسلة...',
            quickReaction: '♥'
        }
    },

    get: function(channel) {
        return this.themes[channel] || this.themes.messenger;
    },

    apply: function(channel) {
        const theme = this.get(channel);
        const shell = document.getElementById('conversation-shell');
        if (shell) {
            shell.dataset.channel = theme.id;
            shell.style.setProperty('--channel-accent', theme.accent);
        }
        const input = document.getElementById('direct-msg-input');
        if (input && window.Dashboard.state.currentMessageType !== 'note') {
            input.placeholder = theme.composerPlaceholder;
        }
        return theme;
    }
};
