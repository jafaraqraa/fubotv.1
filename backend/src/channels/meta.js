const { addLog, reportError } = require('../services/logger');

// دالة جلب معلومات ملف مستخدم Meta الشخصي (الاسم الحقيقي)
async function getMetaUserProfile(psid, platform) {
    const accessToken = platform === 'messenger' ? process.env.MESSENGER_ACCESS_TOKEN : process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!accessToken) return null;
    try {
        const response = await fetch(`https://graph.facebook.com/v19.0/${psid}?fields=first_name,last_name&access_token=${accessToken}`);
        if (response.ok) {
            const data = await response.json();
            return `${data.first_name || ''} ${data.last_name || ''}`.trim() || null;
        }
    } catch (e) {
        console.error("Error fetching Meta user profile:", e.message);
    }
    return null;
}

// دالة إرسال الرسائل لفيسبوك وانستجرام عبر بروتوكولات Meta Graph API وحماية الثغرات
async function sendMetaMessage(recipientId, text, platform) {
    const accessToken = platform === 'messenger' ? process.env.MESSENGER_ACCESS_TOKEN : process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!accessToken) {
        addLog(`⚠️ خطأ: لم يتم ضبط توكن إرسال الـ API لـ ${platform} بعد.`);
        return;
    }

    try {
        const response = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${accessToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: { text: text }
            })
        });

        const data = await response.json();

        if (response.ok) {
            console.log(`✅ تم إرسال الرد للعميل على منصة [${platform}] بنجاح!`);
        } else {
            const errorMsg = data.error && data.error.message ? data.error.message : JSON.stringify(data);
            reportError(`إرسال ميتّا (${platform})`, errorMsg);
        }
    } catch (error) {
        reportError(`اتصال ميتّا خطأ شبكة (${platform})`, error.message);
    }
}

module.exports = {
    getMetaUserProfile,
    sendMetaMessage
};
