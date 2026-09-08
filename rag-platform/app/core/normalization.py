import re

ARABIC_SEARCH_ALIASES = {
    "اسم": "name", "شركتك": "company", "الشركة": "company",
    "شغل": "services provides", "الشغل": "services provides", "عندكم": "company",
    "سعر": "price list", "السعر": "price list", "قديش": "how much",
    "سعة": "capacity", "سعتها": "capacity", "كفالة": "warranty",
    "كفالتها": "warranty", "كفالته": "warranty", "ضمان": "warranty",
    "اشتراك": "subscription monthly fee", "الاشتراك": "subscription monthly fee",
    "الشهري": "monthly", "إجازة": "annual leave", "اجازة": "annual leave",
    "الإجازة": "annual leave", "الاجازة": "annual leave", "أرحل": "carried",
    "ارحل": "carried", "ترحيل": "carried", "السنة": "year", "الجاية": "next",
}

def normalize_text(text: str) -> str:
    if not text:
        return ""

    # Preserve original exact identifiers (SKUs, codes like HR-17, numbers)
    # 1. Normalize line endings
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # 2. Remove non-printable control characters except newline and tab
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)

    # 3. Handle Arabic Tatweel (ـ)
    text = re.sub(r'\u0640', '', text)

    # 4. Standardize Arabic Alef variants (أ أ إ آ -> ا) for semantic search while leaving exact codes intact
    text = re.sub(r'[\u0622\u0623\u0625]', '\u0627', text)
    # Standardize Alef Maqsura (ى -> ي)
    text = re.sub(r'\u0649', '\u064A', text)

    # 5. Collapse multiple spaces into single space while retaining newlines
    lines = [re.sub(r'[ \t]+', ' ', line).strip() for line in text.split('\n')]

    # 6. Remove excessive blank lines
    filtered_lines = []
    blank_count = 0
    for line in lines:
        if not line:
            blank_count += 1
            if blank_count <= 2:
                filtered_lines.append("")
        else:
            blank_count = 0
            filtered_lines.append(line)

    return "\n".join(filtered_lines).strip()

def search_tokens(text: str) -> set[str]:
    normalized = normalize_text(text).lower()
    raw_tokens = re.findall(r'[\w.-]+', normalized, flags=re.UNICODE)
    expanded = []
    for token in raw_tokens:
        alias = ARABIC_SEARCH_ALIASES.get(token)
        expanded.extend(alias.split() if alias else [token])
    return {token for token in expanded if len(token) > 1}
