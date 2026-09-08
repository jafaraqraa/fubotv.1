import math
import re
from typing import List, Dict, Tuple, Any

class BM25SparseEncoder:
    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.vocab: Dict[str, int] = {}
        self.doc_lengths: List[int] = []
        self.avg_doc_len: float = 0.0

    def _tokenize(self, text: str) -> List[str]:
        raw_tokens = [t.lower() for t in re.findall(r'[\u0600-\u06FFa-zA-Z0-9_\-]+', text) if len(t) > 1]
        tokens = []
        for t in raw_tokens:
            tokens.append(t)
            if "-" in t:
                parts = t.split("-")
                for p in parts:
                    if len(p) > 1:
                        tokens.append(p)
        return tokens

    def encode_text(self, text: str) -> Dict[str, Any]:
        tokens = self._tokenize(text)
        term_freqs: Dict[str, int] = {}
        for t in tokens:
            term_freqs[t] = term_freqs.get(t, 0) + 1

        indices = []
        values = []

        for token, count in term_freqs.items():
            if token not in self.vocab:
                self.vocab[token] = len(self.vocab) + 1
            indices.append(self.vocab[token])
            values.append(float(math.log(1 + count)))

        return {"indices": indices, "values": values}
