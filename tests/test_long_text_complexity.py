"""Regression for v1.1.56.32: preserve conversion decisions while removing
quadratic scans and repeated browser Target.context serialization."""
import json
import random
import time
import unittest
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'python'),str(ROOT/'python/backend/upstream'),
              str(ROOT/'python/browser-support')]
from app.services.tokenizer import MorphToken
from app.services.quantity import has_quantity_before,indexed_quantity_before
from backend.loanwords import collect
from browser_bridge import compact_analysis_wire


def token(text,form,tag,start):
    return MorphToken(form=form,tag=tag,start=start,length=len(form),
                      original=text[start:start+len(form)],is_hangul=True,
                      is_noun=tag in {'NNG','NNP','NNB','NR'},
                      is_verb_stem=False,is_suffix=False,is_particle=False,is_punct=False)

class ComplexityRegression(unittest.TestCase):
    def test_quantity_index_exactly_matches_old_rule_across_random_unsorted_tokens(self):
        rng=random.Random(711)
        for count in (1,2,5,50,120):
            for repeat in range(8):
                text=''.join(rng.choice('가나우리123   ') for _ in range(220))
                tokens=[]
                for i in range(count):
                    start=rng.randrange(0,len(text))
                    end=min(len(text),start+rng.randrange(1,4))
                    form=text[start:end]
                    tokens.append(token(text,form,rng.choice(('NNG','SN','NR','NNB','JKS')),start))
                rng.shuffle(tokens)
                flags=indexed_quantity_before(text,tokens)
                for t in tokens:
                    self.assertEqual(flags[t.start],has_quantity_before(text,tokens,t.start),
                                     (text,tokens,t.start))
    def test_quantity_index_preserves_tied_token_end_order(self):
        text='1가 개'
        tokens=[token(text,'1','SN',0),token(text,'가','NNG',1),
                token(text,'1','NNG',0),token(text,'개','NNB',3)]
        flags=indexed_quantity_before(text,tokens)
        for t in tokens:
            self.assertEqual(flags[t.start],has_quantity_before(text,tokens,t.start))
        self.assertTrue(flags[1])
    def test_no_quadratic_quantity_scans_with_long_text(self):
        text='가나 '*3000
        tokens=[token(text,'가나','NNG',3*i) for i in range(3000)]
        t0=time.perf_counter()
        flags=indexed_quantity_before(text,tokens)
        elapsed=time.perf_counter()-t0
        self.assertEqual(len(flags),3000)
        self.assertTrue(all(flag is False for flag in flags.values()))
        self.assertLess(elapsed,0.4,'predecessor index must be fast for thousands of tokens')
    def test_loanword_partial_and_occupied_regressions(self):
        text='컴퓨터 가나 가나'
        tokens=[
            token(text,'컴','NNG',0),token(text,'퓨터','NNG',1),
            token(text,'가나','NNG',4),token(text,'가나','NNG',7)]
        entries={'컴':[dict(id=1,origin_raw='Com',part_of_speech='명사',definition_preview='x')],
                 '퓨터':[dict(id=2,origin_raw='puter',part_of_speech='명사',definition_preview='x')],
                 '가나':[dict(id=3,origin_raw='Gana',part_of_speech='명사',definition_preview='x')]}
        result=collect(text,tokens,entries,[],hanja_enabled=True)
        self.assertEqual([a['surface'] for a in result['annotations']],['가나','가나'])
        self.assertEqual([t['surface'] for t in result['targets']],['컴','퓨터'])
        filtered=collect(text,tokens,entries,[(4,6)],hanja_enabled=True)
        self.assertEqual([a['surface'] for a in filtered['annotations']],['가나'])
        # Protect source overlap regardless of the arbitrary initial range order.
        filtered=collect(text,tokens,entries,[(7,9),(4,6)],hanja_enabled=True)
        self.assertEqual([a['surface'] for a in filtered['annotations']],[])
    def test_long_loanword_scan_scale(self):
        n=2400;text='가나 '*n
        tokens=[token(text,'가나','NNG',3*i) for i in range(n)]
        entry=dict(id=1,origin_raw='Gana',part_of_speech='명사',definition_preview='x')
        start=time.perf_counter()
        result=collect(text,tokens,{'가나':[entry]},[],hanja_enabled=True)
        elapsed=time.perf_counter()-start
        self.assertEqual(len(result['annotations']),n)
        self.assertLess(elapsed,0.65,'indexed loanword scans should not show quadratic scaling')
    def test_browser_result_shares_context_and_preserves_original_python_result(self):
        text='가나다 '*3500
        original={'targets':[{'target_id':f't{i}','start':i*4,'end':i*4+3,
                               'surface':'가나다','context':text,'options':[]}
                             for i in range(1200)],'stats':{}}
        compact=compact_analysis_wire(original)
        self.assertEqual(original['targets'][0]['context'],text)
        self.assertTrue(all('context' not in t for t in compact['targets']))
        self.assertEqual(compact['targets'][550]['surface'],original['targets'][550]['surface'])
        self.assertLess(len(json.dumps(compact,ensure_ascii=False)),250000)

if __name__=='__main__':unittest.main(verbosity=2)
