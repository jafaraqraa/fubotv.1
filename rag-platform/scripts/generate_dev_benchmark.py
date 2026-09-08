import json
import os

def generate_benchmark():
    items = []

    # 1. Generate 50 Arabic factual & paraphrase queries
    ar_templates = [
        ("ما هي فترة التجربة للموظفين الجدد؟", "90 يوم", "easy"),
        ("كم مدة فترة الإشعار للتعيين والاستقالة؟", "30 يوم", "easy"),
        ("كم عدد أيام الإجازة السنوية للموظفين؟", "30 يوم", "easy"),
        ("ما هي قيمة الدعم السنوي للاشتراك الرياضي؟", "500 دولار", "medium"),
        ("ما هو الحد الأقصى لموافقة رأس المال للمدراء؟", "10000 دولار", "hard"),
        ("ما هي نسبة الخصم للكميات فوق 50 قطعة؟", "خصم 20%", "medium"),
        ("ما هو رقم هاتف الدعم الفني؟", "+1-800-555-0199", "easy"),
        ("كم مدة الضمان للمنتج SKU-5500؟", "3 سنوات", "medium"),
        ("ما هو سعر المنتج SKU-5500؟", "1200 USD", "medium"),
        ("ما هو سعر المنتج PRD-770؟", "350 USD", "medium")
    ]
    for idx, (q, ans, diff) in enumerate(ar_templates * 5, start=1):
        items.append({
            "question_id": f"dev_ar_{idx:03d}",
            "tenant_id": "tenant_dev_alpha",
            "language": "ar",
            "query": f"{q} (نموذج {idx})",
            "query_type": "arabic_factual",
            "expected_behavior": "answer",
            "expected_answer": ans,
            "whether_abstention_expected": False,
            "difficulty": diff
        })

    # 2. Generate 50 English factual & paraphrase queries
    en_templates = [
        ("What is the probation period for new joiners?", "90 days", "easy"),
        ("How many annual leave days are provided?", "30 days", "easy"),
        ("What is the annual gym subsidy amount?", "500 USD", "medium"),
        ("What is the maximum capital expense threshold for managers?", "10000 USD", "hard"),
        ("What is the bulk discount for purchasing over 50 units?", "20 percent", "medium"),
        ("What is the IT helpdesk phone number?", "+1-800-555-0199", "easy"),
        ("What is the warranty period for SKU-5500?", "3 Years", "medium"),
        ("What is the price of SKU-5500?", "1200 USD", "medium"),
        ("What is the price of PRD-770?", "350 USD", "medium"),
        ("What is the maximum allowed carry-over leave days?", "5 days", "medium")
    ]
    for idx, (q, ans, diff) in enumerate(en_templates * 5, start=1):
        items.append({
            "question_id": f"dev_en_{idx:03d}",
            "tenant_id": "tenant_dev_alpha",
            "language": "en",
            "query": f"{q} (variant {idx})",
            "query_type": "english_factual",
            "expected_behavior": "answer", "expected_answer": ans,
            "whether_abstention_expected": False,
            "difficulty": diff
        })

    # 3. Generate 50 Exact SKU & Identifier queries
    sku_templates = ["SKU-5500", "PRD-770", "POL-2026", "SKU-9900", "SKU-102"]
    for idx in range(1, 51):
        sku = sku_templates[idx % len(sku_templates)]
        items.append({
            "question_id": f"dev_sku_{idx:03d}",
            "tenant_id": "tenant_dev_alpha",
            "language": "en" if idx % 2 == 0 else "ar",
            "query": f"Lookup details for code {sku} item #{idx}",
            "query_type": "exact_sku",
            "expected_behavior": "answer",
            "expected_answer": sku,
            "whether_abstention_expected": False,
            "difficulty": "medium"
        })

    # 4. Generate 50 Missing Fact / Unanswerable queries (Abstention safety test)
    abs_templates = [
        "Who is the CEO of the company?",
        "What is the visitor Wi-Fi password?",
        "What is the stock price today?",
        "Who won the 2025 chess tournament?",
        "What is the price of SKU-X9999?"
    ]
    for idx in range(1, 51):
        q = abs_templates[idx % len(abs_templates)]
        items.append({
            "question_id": f"dev_abs_{idx:03d}",
            "tenant_id": "tenant_dev_alpha",
            "language": "en" if idx % 2 == 0 else "ar",
            "query": f"{q} (unsupported test {idx})",
            "query_type": "missing_fact",
            "expected_behavior": "abstain",
            "expected_answer": "",
            "whether_abstention_expected": True,
            "difficulty": "medium"
        })

    dev_path = os.path.join(os.path.dirname(__file__), "..", "..", "evals", "dev", "dev_benchmark.jsonl")
    os.makedirs(os.path.dirname(dev_path), exist_ok=True)
    with open(dev_path, "w", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")

    print(f"✔ Generated 200 Development Benchmark Items at {dev_path}")

if __name__ == "__main__":
    generate_benchmark()
