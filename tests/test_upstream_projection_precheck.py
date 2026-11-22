import sqlite3
import unittest

from test_experimental_hanja_audit import with_tokens
from test_quantity_bonus import Tests
from backend.analysis import Engine


class UpstreamProjectionPrecheck(unittest.IsolatedAsyncioTestCase):
    asyncSetUp=Tests.asyncSetUp
    asyncTearDown=Tests.asyncTearDown
    add=Tests.add

    async def analyze(self,text,parts,**options):
        engine=Engine(self.path,tokenizer=with_tokens(parts))
        modes=dict(hanja=True,loanword=False,nameProtection=False,
                   reviewAll=True,reviewPosFilter=True)
        modes.update(options)
        return await engine.analyze(text,modes)

    async def test_lemma_lookup_must_not_turn_a_single_stem_into_two_hanja(self):
        # The exact dictionary hit is '주다' (the Kiwi lemma), not the
        # actually visible one-syllable source span '주'.
        self.add('주다','酒多','동사','Synthetic test entry.')
        r=await self.analyze('주',[('주','VV',0)])
        self.assertGreaterEqual(r['stats']['upstream_alignment_pruned'],1)
        self.assertFalse(any('酒多' in str(o.get('replacement',''))
            for t in r['targets'] for o in t['options']))
        self.assertFalse(any('酒多' in str(a.get('replacement',''))
            for a in r['annotations']))

    async def test_nonmatching_longer_stem_candidate_is_removed_at_source(self):
        eid=self.add('상스럽다','常','형용사','Synthetic malformed candidate.')
        with sqlite3.connect(self.path) as db:
            db.execute('INSERT INTO conversion_candidates(written_form,entry_id,origin_raw,replacement,replacement_type,is_reliable) VALUES(?,?,?,?,?,1)',
                       ('상스럽다',eid,'常','常','pure_hanja'))
        r=await self.analyze('상스러운',[('상스럽','VA',0)])
        self.assertGreaterEqual(r['stats']['upstream_alignment_pruned'],1)
        self.assertFalse(any(o.get('replacement')=='常'
            for t in r['targets'] for o in t['options']))

    async def test_exact_hangul_entry_keeps_ordinary_candidates(self):
        r=await self.analyze('학교',[('학교','NNG',0)])
        self.assertEqual(r['stats']['upstream_alignment_pruned'],0)
        self.assertTrue(r['targets'] or r['annotations'])

    async def test_ha_conjugation_keeps_a_provable_unchanged_hangul_anchor(self):
        eid=self.add('위하다','爲하다','동사','Synthetic transparent verb.')
        with sqlite3.connect(self.path) as db:
            db.execute('INSERT INTO conversion_candidates(written_form,entry_id,origin_raw,replacement,replacement_type,is_reliable) VALUES(?,?,?,?,?,1)',
                       ('위하다',eid,'爲하다','爲','pure_hanja'))
        r=await self.analyze('위한',[('위하','VV',0)])
        self.assertEqual(r['stats']['upstream_alignment_pruned'],0)
        self.assertTrue(any('爲' in str(a.get('replacement',''))
            for a in r['annotations']) or
            any('爲' in str(o.get('replacement',''))
                for t in r['targets'] for o in t['options']))

    async def test_disabling_pos_filter_does_not_bypass_source_alignment(self):
        self.add('주다','酒多','명사','Synthetic homograph.')
        r=await self.analyze('주',[('주','VV',0)],reviewPosFilter=False)
        self.assertGreaterEqual(r['stats']['upstream_alignment_pruned'],1)


if __name__=='__main__':
    unittest.main(verbosity=2)
