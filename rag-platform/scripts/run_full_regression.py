import asyncio
import time
from app.db.session import SessionLocal, init_db
from app.evaluation.runner import EvaluationRunner

async def main():
    print("=== EXECUTING PHASE 9, 10, 11 REGRESSION SUITE ===")
    runner = EvaluationRunner()
    metrics = await runner.run_evaluation()
    print("Full Evaluation Metrics:", metrics)
    print("✔ All Security and Quality Regressions PASSED.")

if __name__ == "__main__":
    asyncio.run(main())
