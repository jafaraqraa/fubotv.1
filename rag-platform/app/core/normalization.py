import re

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

    # 4. Collapse multiple spaces into single space while retaining newlines
    lines = [re.sub(r'[ \t]+', ' ', line).strip() for line in text.split('\n')]

    # 5. Remove excessive blank lines
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
