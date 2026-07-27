// Central Dashboard State Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.state = {
    selectedUserId: null,
    isModelLoaded: false,
    isKnowledgeLoaded: false,
    isPromptLoaded: false,
    isAdminIdLoaded: false,
    isWaAutoReplyLoaded: false,
    isMetaVerifyLoaded: false,
    isMessengerLoaded: false,
    isInstagramLoaded: false,
    isMessengerAutoReplyLoaded: false,
    isInstagramAutoReplyLoaded: false,

    usersCache: [],
    pendingToggleUserId: null,
    currentChatFilter: 'all',
    showUnreadOnly: false,

    platformChartInstance: null,
    messageChartInstance: null,

    pendingSettingsPayload: null,
    pendingSettingsType: "",

    currentMessageType: 'reply', // 'reply' or 'note'
    selectedMediaFile: null,

    // Static canned responses
    cannedResponses: [
        { trigger: "ترحيب", text: "أهلاً بك في FUThing! كيف يمكننا مساعدتك اليوم؟" },
        { trigger: "حساب", text: "يمكنك إتمام الدفع عبر الحساب البنكي التالي: بنك فلسطين، رقم الحساب: 1234567" },
        { trigger: "توصيل", text: "تكلفة الشحن لجميع المحافظات هي 20 شيكل، ويستغرق التوصيل من 2 إلى 4 أيام عمل." },
        { trigger: "دوام", text: "أوقات العمل الرسمية لدينا هي من السبت إلى الخميس، من الساعة 9:00 صباحاً وحتى 5:00 مساءً." }
    ]
};
