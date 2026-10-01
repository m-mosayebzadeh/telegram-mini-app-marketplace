"""
The interests people can pick in Echo, and the groups they sit in
(TECHNICAL_REQUIREMENTS.md section 32).

The list will grow to two hundred and more, so the picker shows a handful
of groups rather than every interest at once: tap a group, see what is in
it. Five groups now, room for a sixth; more than about eight would turn the
groups themselves back into a long list, which is the problem they solve.
New interests go into the existing groups.

The groups also help people meet: two people who picked different
interests in the same group (physics and chemistry, say) still have
something to talk about, so the matcher gives that a smaller weight of
its own (matching.py), and the card says "both into science".

The app keeps its own copy of this list (frontend/src/lib/echoApi.ts);
the two must stay the same.
"""

#: group -> its interests, in the order the picker shows them.
TAG_GROUPS: dict[str, tuple[str, ...]] = {
    "fun": ("music", "film", "art", "photography", "games"),
    "learning": ("books", "study", "language", "tech"),
    "work": ("work", "startup", "advice"),
    "life": ("sport", "travel", "food", "nature", "animals"),
    "talk": ("nightowl", "deeptalk", "smalltalk"),
}

#: Every interest, once, in the groups' order.
SEARCH_TAGS: tuple[str, ...] = tuple(tag for tags in TAG_GROUPS.values() for tag in tags)

GROUP_OF: dict[str, str] = {tag: group for group, tags in TAG_GROUPS.items() for tag in tags}


def shared_groups(mine: list[str] | None, theirs: list[str] | None) -> list[str]:
    """The groups both picked something in, besides the ones where they
    picked the very same interest — that is already said by the interest
    itself, and saying it twice would count it twice."""
    mine, theirs = mine or [], theirs or []
    same = {GROUP_OF.get(tag) for tag in mine if tag in theirs}
    their_groups = {GROUP_OF.get(tag) for tag in theirs}
    found: list[str] = []
    for tag in mine:
        group = GROUP_OF.get(tag)
        if group and group in their_groups and group not in same and group not in found:
            found.append(group)
    return found
