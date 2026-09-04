function requestedKnowledgeMediaType(text) {
    const value = String(text || '').normalize('NFKC').toLowerCase();
    const action = '(?:ابعث|ارسل|أرسل|اعرض|ورجيني|فرجيني|شغل|بدي|اريد|أريد|مين|من|شو|ماذا|ما|send|show|play|who|what)';
    const image = '(?:صوره|صورة|صور|image|photo|picture)';
    const audio = '(?:صوت|صوتي|تسجيل|اغنيه|أغنية|انشوده|أنشودة|audio|voice|recording)';
    if (new RegExp(`${action}.{0,80}${audio}|${audio}.{0,80}${action}`, 'i').test(value)) return 'audio';
    if (new RegExp(`${action}.{0,80}${image}|${image}.{0,80}${action}`, 'i').test(value)) return 'image';
    return null;
}

module.exports = { requestedKnowledgeMediaType };
