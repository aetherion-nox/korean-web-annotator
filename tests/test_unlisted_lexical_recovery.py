import unittest, types
import test_quantity_bonus as fixture
from backend.analysis import Engine
from backend.risk_review import uncertain_compounds

class UnlistedLexicalRecovery(unittest.IsolatedAsyncioTestCase):
    asyncSetUp=fixture.Tests.asyncSetUp
    asyncTearDown=fixture.Tests.asyncTearDown
    add=fixture.Tests.add

    def with_tokens(self,parts):
        tk=fixture.tokenizer()
        tk._kiwi=types.SimpleNamespace(tokenize=lambda _:[
            types.SimpleNamespace(form=form,tag=tag,start=start,len=len(form))
            for form,tag,start in parts
        ])
        return tk

    async def analyze(self,text,parts,*,experimental=True):
        return await Engine(self.path,tokenizer=self.with_tokens(parts)).analyze(text,{
            'hanja':True,'loanword':True,'nameProtection':False,
            'uniqueCandidateRiskReview':True,
            'singleHangulLocalGuard':True,
            'allowModelSegmentation':experimental
        })

    async def test_multi_syllable_components_not_in_complete_dictionary_are_reviewable(self):
        self.add('수질','水質','명사','물의 품질.')
        self.add('정보','情報','명사','사실이나 지식.')
        self.add('기관','機關','명사','조직.')
        r=await self.analyze('수질정보기관이',[
            ('수질','NNG',0),('정보','NNG',2),('기관','NNG',4),('이','JKS',6)
        ])
        self.assertFalse(r['annotations'],r)
        self.assertTrue(any(x['surface']=='수질정보기관' and x['reason']=='kiwi_split_no_full_headword'
                            for x in r['boundary_risks']),r)

    async def test_entirely_unlisted_nominal_compound_still_enters_review(self):
        r=await self.analyze('신조경제대책',[
            ('신조','NNG',0),('경제','NNG',2),('대책','NNG',4)
        ])
        self.assertTrue(any(x['surface']=='신조경제대책' and x['reason']=='kiwi_split_no_full_headword'
                            for x in r['boundary_risks']),r)

    async def test_unlisted_standalone_noun_without_dictionary_components(self):
        r=await self.analyze('사회정보위원회를',[
            ('사회정보위원회','NNG',0),('를','JKO',7)
        ])
        self.assertTrue(any(x['surface']=='사회정보위원회' and x['reason']=='unlisted_nominal_headword'
                            for x in r['boundary_risks']),r)
        self.assertFalse(r['annotations'],r)

    async def test_generic_kiwi_proper_noun_hint_does_not_ban_unknown_institution(self):
        r=await self.analyze('사회정보위원회',[
            ('사회정보위원회','NNP',0)
        ])
        self.assertTrue(any(x['reason']=='unlisted_nominal_headword' for x in r['boundary_risks']),r)

    async def test_known_complete_headword_is_not_reconstructed_just_because_kiwi_splits_it(self):
        self.add('학교사회','學校社會','명사','학교를 중심으로 한 사회.')
        r=await self.analyze('학교사회',[('학교','NNG',0),('사회','NNG',2)])
        self.assertFalse(any(x['reason'] in {'unlisted_nominal_headword','kiwi_split_no_full_headword'}
                             for x in r['boundary_risks']),r)

    async def test_experimental_switch_disables_freestanding_unlisted_nominal_scans(self):
        r=await self.analyze('사회정보위원회',[('사회정보위원회','NNG',0)],experimental=False)
        self.assertFalse(any(x['reason']=='unlisted_nominal_headword' for x in r['boundary_risks']),r)

    async def test_native_inflected_predicate_does_not_become_missing_noun(self):
        r=await self.analyze('아름답게',[('아름답','VA',0),('게','EC',3)])
        self.assertFalse(any(x['reason']=='unlisted_nominal_headword' for x in r['boundary_risks']),r)

    async def test_actual_person_protection_uses_source_spans(self):
        async def lookup(forms):return {}
        nouns=[types.SimpleNamespace(form='성명',tag='NNP',start=0,length=2),
               types.SimpleNamespace(form='기록',tag='NNG',start=2,length=2)]
        open_risks=await uncertain_compounds('성명기록',nouns,lookup,include_unlisted=True)
        closed_risks=await uncertain_compounds('성명기록',nouns,lookup,
                                                blocked=[(0,4)],include_unlisted=True)
        self.assertTrue(open_risks)
        self.assertFalse(closed_risks)

if __name__=='__main__':unittest.main(verbosity=2)
