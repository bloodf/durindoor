import re, collections
lines = open('.omc/review-3days/baseline-diff.patch').read().splitlines()
adds = [l[1:] for l in lines if l.startswith('+') and not l.startswith('+++')]
rems = [l[1:] for l in lines if l.startswith('-') and not l.startswith('---')]
def grp(items):
    c = collections.Counter()
    for s in items:
        head = s.split(' :: ', 1)[0]
        c[head] += 1
    return c
print('adds total:', len(adds))
print('rems total:', len(rems))
print('net:', len(adds) - len(rems))
print('---adds by file---')
for k, v in grp(adds).most_common():
    print(f"  {v:>3}  {k}")
print('---rems by file---')
for k, v in grp(rems).most_common():
    print(f"  {v:>3}  {k}")
print('---items added that are NOT pure baseline growth (suspicious = added without matching removal)---')
added = set(adds); removed = set(rems)
suspicious = [a for a in adds if a not in removed]
for s in suspicious:
    print(' +', s)
