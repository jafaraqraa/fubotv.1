const botData = {
    users: {},
    messages: [],
    messagesCount: 0,
    recentLogs: [],
    errors: [] // مصفوفة لتخزين الأعطال الفنية { id, date, time, type, message, solved }
};

module.exports = botData;
