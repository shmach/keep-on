# Coach: Dynamic distraction phrases (design)

Date: 2026-08-02

## Problem

The alarm overlay's coach phrase is supposed to escalate in tone across repeated
distractions. In practice it's broken: `content/overlay.js` calls
`getCoachMoment` with `sessionInfo.distraction` (singular), but the session
object's field is `distractions` (plural, `background/service_worker.js`
`session.distractions++`). The lookup key ends up as the literal string
`"distraction_undefined"`, which has no entry in `coach.js`'s phrase table, so
`response.phrase` stays `undefined` and the coach speech bubble in the overlay
is silently blank on every distraction today.

Separately, even where the plumbing works (tiers), each tier has exactly one
hardcoded phrase — no randomization actually happens.

## Goal

Fix the bug, then make the distraction phrase feel alive by blending three
independent sources of commentary, chosen at random each time the overlay
appears:

1. **Escalating tone** by distraction count in the current session (already
   partially exists: 1st / 2nd / 3rd / 4th+).
2. **"You just started" callout** — when the user falls into the distraction
   within a few minutes of the session starting.
3. **Site-specific jab** — a joke that names the actual site the user is on,
   with recognizable flavor text for the sites in the default blacklist and a
   generic fallback for anything else.

Scope is limited to the distraction/alarm-overlay context. `welcome` and
`active` phrase pools are unchanged.

## Data flow

`content/overlay.js` already computes `minutesIn` locally
(`Math.round((Date.now() - sessionInfo.startedAt) / 1000 / 60)`) and runs
inside the actual page, so it has `location.hostname` for free. No new
message needs to travel through the service worker.

`showAlarmOverlay` will call:

```js
getCoachMoment('distraction', {
  distractions: sessionInfo.distractions,   // bug fix: was sessionInfo.distraction
  minutesIn,
  site: location.hostname.replace(/^www\./, '')
});
```

## Phrase data structure (`lib/coach.js`)

```js
phrases: {
  welcome: [...],   // unchanged
  active: [...],    // unchanged
  distraction: {
    1: [ /* 3-4 generic phrases, mild tone */ ],
    2: [ /* 3 generic phrases, more annoyed */ ],
    3: [ /* 3 generic phrases, angrier */ ],
    infinity: [ /* 3 generic phrases, comically furious, 4th+ */ ]
  },
  quickRelapse: [ /* 3 phrases, shared across all tiers, uses {minutes} */ ],
  sitePhrases: {
    twitter:   [ /* uses {site} */ ],
    reddit:    [...],
    instagram: [...],
    tiktok:    [...],
    facebook:  [...],
    youtube:   [...],
    netflix:   [...],
    hulu:      [...],
    twitch:    [...],
    default:   [ /* fallback for any blacklisted site not listed above */ ]
  }
}
```

`quickRelapse` and `sitePhrases` are **not** nested per-tier — they're each a
single shared pool layered on top of whichever tier applies, keeping content
compact (no need to write 4x variations of the same "you just started" joke).

### Tier selection

```js
const tier = data.distractions >= 4 ? 'infinity' : data.distractions; // 1, 2, 3, or 'infinity'
```

### Site key matching

A small local helper in `coach.js` (no new dependency on `lib/shared.js`,
which isn't loaded in the content-script context today):

```js
const SITE_ALIASES = {
  'twitter.com': 'twitter', 'x.com': 'twitter',
  'reddit.com': 'reddit',
  'instagram.com': 'instagram',
  'tiktok.com': 'tiktok',
  'facebook.com': 'facebook',
  'youtube.com': 'youtube',
  'netflix.com': 'netflix',
  'hulu.com': 'hulu',
  'twitch.tv': 'twitch'
};

function matchSiteKey(hostname) {
  for (const [domain, key] of Object.entries(SITE_ALIASES)) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return { key, canonicalDomain: domain };
    }
  }
  return { key: 'default', canonicalDomain: hostname };
}
```

The `{site}` placeholder always resolves to `canonicalDomain` — the clean
domain name (e.g. `youtube.com`), not whatever subdomain the user is actually
on (e.g. `m.youtube.com`) — so the joke text stays readable.

### Combining and picking

```js
function getCoachMoment(context, data) {
  if (context === 'distraction') {
    const tier = data.distractions >= 4 ? 'infinity' : data.distractions;
    let pool = [...coaches.max.phrases.distraction[tier]];

    if (data.minutesIn < QUICK_RELAPSE_MINUTES) {
      pool = pool.concat(coaches.max.phrases.quickRelapse);
    }

    const { key, canonicalDomain } = matchSiteKey(data.site || '');
    pool = pool.concat(coaches.max.phrases.sitePhrases[key]);

    const raw = pool[Math.floor(Math.random() * pool.length)];
    const phrase = raw
      .replace(/\{minutes\}/g, data.minutesIn)
      .replace(/\{distractions\}/g, data.distractions)
      .replace(/\{site\}/g, canonicalDomain);

    return { phrase, image: chrome.runtime.getURL(coaches.max.images.base) };
  }

  // existing welcome/active behavior unchanged
}
```

`QUICK_RELAPSE_MINUTES = 5` — a module-level constant, easy to retune.

## Phrase copy (tone: same energetic/all-caps deboche as existing phrases)

**distraction[1]:**
- "HEY! STOP GETTING DISTRACTED AND GET BACK TO WORK!"
- "OH COME ON, YOU JUST STARTED AND ALREADY WANDERING OFF?"
- "ONE DISTRACTION DOWN. LET'S NOT MAKE IT A HABIT, OKAY?"
- "I SAW THAT. GET BACK TO YOUR TAB, CHAMP."

**distraction[2]:**
- "ARE YOU KIDDING ME? AGAIN? FOCUS ON YOUR WORK!!!"
- "TWICE NOW? I'M WATCHING YOU."
- "WE TALKED ABOUT THIS. BACK TO WORK, LET'S GO."

**distraction[3]:**
- "WHAT IS WRONG WITH YOU? FOCUS ON YOUR WORK!!!!"
- "THIRD TIME. I'M NOT EVEN SURPRISED ANYMORE, JUST DISAPPOINTED."
- "OKAY THAT'S THREE. AT THIS POINT YOU'RE DOING IT ON PURPOSE."

**distraction[infinity]** (4th+):
- "I CAN'T BELIEVE YOU KEEP GETTING DISTRACTED! FOCUS ON YOUR WORK NOW!!!!!"
- "{distractions} DISTRACTIONS. I'VE LOST COUNT OF HOW ANGRY I AM."
- "AT THIS POINT I SHOULD JUST CHARGE YOU RENT FOR LIVING ON THAT SITE."

**quickRelapse** (minutesIn < 5):
- "IT'S BEEN {minutes} MINUTES AND YOU'RE ALREADY HERE? THAT'S A NEW RECORD."
- "WOW, {minutes} MINUTES OF FOCUS. IMPRESSIVE... IF WE WERE TIMING A GOLDFISH."
- "{minutes} MINUTES IN AND YOU'RE ALREADY SLIPPING? COME ON."

**sitePhrases.twitter:**
- "DOOMSCROLLING {site} ISN'T GOING TO FINISH YOUR WORK FOR YOU."
- "THE TIMELINE WILL STILL BE THERE AFTER YOUR SESSION. PROMISE."

**sitePhrases.reddit:**
- "REDDIT AGAIN? THE FRONT PAGE WILL STILL BE THERE IN AN HOUR."
- "OH, SO YOUR DEADLINE CAN WAIT BUT {site} CAN'T?"

**sitePhrases.instagram:**
- "THOSE STORIES WILL STILL BE THERE. YOUR DEADLINE WON'T WAIT."
- "{site} ISN'T GOING ANYWHERE. YOUR FOCUS SHOULD BE."

**sitePhrases.tiktok:**
- "ONE MORE VIDEO TURNS INTO ONE MORE HOUR ON {site}. YOU KNOW THIS."
- "THE ALGORITHM ON {site} IS UNDEFEATED, BUT SO ARE YOUR DEADLINES. GO."

**sitePhrases.facebook:**
- "NOTHING ON {site} IS MORE URGENT THAN WHAT YOU'RE AVOIDING."
- "{site}? REALLY? IN THIS ECONOMY?"

**sitePhrases.youtube:**
- "'JUST ONE VIDEO' ON {site} IS HOW YOU LOSE AN HOUR. CLOSE IT."
- "{site} HAS BILLIONS OF VIDEOS. NONE OF THEM ARE YOUR DEADLINE."

**sitePhrases.netflix:**
- "IT'S A WORK SESSION, NOT MOVIE NIGHT. CLOSE {site}."
- "{site} WILL STILL HAVE SOMETHING TO WATCH LATER. GO FOCUS."

**sitePhrases.hulu:**
- "SAME ENERGY AS NETFLIX, {site}. CLOSE THE TAB."
- "YOUR SHOW CAN WAIT. YOUR DEADLINE CAN'T."

**sitePhrases.twitch:**
- "WATCHING SOMEONE ELSE WORK ON {site} ISN'T THE SAME AS YOU WORKING."
- "{site} STREAMS ARE LIVE 24/7. YOUR FOCUS WINDOW ISN'T."

**sitePhrases.default** (any other blacklisted domain the user added themselves):
- "{site} ISN'T GOING TO FINISH ITSELF... WAIT, I MEAN YOUR WORK."
- "WHATEVER {site} HAS FOR YOU, YOUR SESSION HAS SOMETHING BETTER: PROGRESS."

## Error handling

- `data.site` missing/empty → `matchSiteKey('')` falls through to `default`
  with `canonicalDomain: ''`, producing a slightly odd but harmless phrase
  ("ISN'T GOING TO FINISH ITSELF"-style text with a blank site name). This is
  an acceptable edge case since `overlay.js` always has `location.hostname`
  available when the overlay is shown — the alarm only fires while the tab is
  actually loaded — so this path shouldn't be hit at runtime.
- Unknown/blank `context` or empty phrase pools: unchanged from existing
  behavior (`getCoachMoment` skips setting `response.phrase`, and
  `overlay.js`/`popup.js` already guard with `if (phrase) ...`).
- Image loading failure: unchanged, already handled via `onerror` in
  `overlay.js`.

## Testing

Manual (no test harness exists in this project):
- Start a session, immediately visit a blacklisted site, wait out the grace
  period → overlay shows a phrase (not blank) — confirms the bug fix.
- Trigger distractions 1 through 4+ in the same session → tone visibly
  escalates and phrases vary between repeats of the same tier.
- Trigger a distraction within 5 minutes of session start → sometimes see a
  "you just started" phrase mentioning the actual elapsed minutes.
- Trigger distractions on reddit.com, youtube.com, and a custom domain added
  to the blacklist via options → each shows site-flavored text with the
  correct `{site}` value (canonical domain for known sites, raw hostname for
  the custom one).
- Confirm `welcome` and `active` popup phrases are unaffected.

## Out of scope

- `welcome` / `active` phrase pool expansion (explicitly deferred by the
  user).
- Mood-based coach images (`happy`/`angry`/`proud`/etc. from `CLAUDE.md`'s
  phase 7 description) — only one placeholder image
  (`assets/coaches/max/coach-test.png`) exists today; art generation is a
  separate effort.
- `complete_good/ok/bad` contexts and a coach card on the session-ended popup
  screen — not wired up in `popup.html`/`popup.js` today, and not part of
  this request.
- i18n / non-English phrases.
