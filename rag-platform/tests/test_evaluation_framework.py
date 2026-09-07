import pytest
from app.evaluation.runner import EvaluationRunner

@pytest.mark.asyncio
async def test_evaluation_runner_execution():
    runner = EvaluationRunner()
    metrics = await runner.run_evaluation()

    assert metrics["total_items"] > 0
    assert metrics["hit_rate"] >= 0.7
    assert metrics["confident_unsupported_answer_rate"] == 0.0
