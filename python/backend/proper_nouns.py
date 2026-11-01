"""Kiwi proper-noun spans are review hints, never proof of a name's origin."""

def proper_noun_ranges(tokens):
    return [(t.start,t.start+t.length) for t in tokens if getattr(t,'tag','').split('-')[0]=='NNP']

def overlaps_proper_noun(start,end,ranges):
    return any(start<b and a<end for a,b in ranges)
