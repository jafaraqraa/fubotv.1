import pytest

from app.generation.grounded_generator import GroundedGenerator
from app.context.context_builder import ContextPayload, EvidenceItem
from app.reranking.reranker import OpenRouterReranker
from app.retrieval.hybrid_retriever import RetrievalCandidate


class FakeResponse:
    def __init__(self, body): self.body = body
    def raise_for_status(self): return None
    def json(self): return self.body


class FakeClient:
    calls = []
    def __init__(self, *args, **kwargs): pass
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    async def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if url.endswith('/rerank'):
            return FakeResponse({'results': [{'index': 1, 'relevance_score': 0.91}]})
        return FakeResponse({'choices': [{'message': {'content': '{"answer":"ok","citations":[]}'}}]})


@pytest.mark.asyncio
async def test_openrouter_reranker_uses_selected_model(monkeypatch):
    monkeypatch.setattr('app.reranking.reranker.httpx.AsyncClient', FakeClient)
    candidates = [
        RetrievalCandidate(chunk_id='1', tenant_id='t', document_id='d', document_version_id='v', title='a', section_title='', content='a', embedding_text='a', content_hash='1'),
        RetrievalCandidate(chunk_id='2', tenant_id='t', document_id='d', document_version_id='v', title='b', section_title='', content='b', embedding_text='b', content_hash='2')
    ]
    ranked = await OpenRouterReranker('key', 'voyageai/rerank-2.5').rerank('q', candidates)
    assert ranked[0].chunk_id == '2'
    assert FakeClient.calls[-1][1]['json']['model'] == 'voyageai/rerank-2.5'


def test_openrouter_generator_keeps_selected_model_and_key():
    generator = GroundedGenerator(provider='openrouter', model='openai/gpt-5', api_key='key')
    assert generator.model == 'openai/gpt-5'
    assert generator.api_key == 'key'
    assert generator.base_url == 'https://openrouter.ai/api/v1'


@pytest.mark.asyncio
async def test_openrouter_generator_always_receives_settings_system_prompt(monkeypatch):
    FakeClient.calls.clear()
    monkeypatch.setattr('app.generation.grounded_generator.httpx.AsyncClient', FakeClient)
    generator = GroundedGenerator(provider='openrouter', model='openai/gpt-5', api_key='key')
    context = ContextPayload(
        formatted_context='[EVIDENCE_01] Atlas Home 5K Battery 5.12 kWh 18,700 10 years',
        evidence_items=[EvidenceItem(
            evidence_id='EVIDENCE_01', chunk_id='c1', tenant_id='t', document_id='d',
            document_version_id='v', title='Catalog', section_title='Batteries',
            content='Atlas Home 5K Battery 5.12 kWh 18,700 10 years'
        )],
        total_tokens=12
    )
    await generator.generate_answer('قديش سعر Atlas Home 5K؟', context, 'رد باللهجة الفلسطينية وباختصار')
    request = FakeClient.calls[-1][1]['json']
    assert request['model'] == 'openai/gpt-5'
    assert request['messages'][0]['content'].startswith('رد باللهجة الفلسطينية وباختصار')
