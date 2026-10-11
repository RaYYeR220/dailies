# Dailies design reference: Loupe

The night's work is a strip of film lying on a switched-off lightbox. A loupe moves along it.
What sits under the glass is what the narrator is talking about, and the only lit thing in the
room is the frame that matters.

The anchor is a photo editor's 4× illuminated loupe on 35 mm stock, and the contact-sheet habit
of marking selects in grease pencil. Everything below follows from those two objects.

The reel renderer (`packages/reel`) is the first implementation. Its tokens live in
`packages/reel/src/theme.ts`; nothing under `src/remotion` carries a colour, a size or a family
of its own.

## Colour

| Token | Value | Use |
|---|---|---|
| `lightbox.far` | `#0d1211` | the room, far from the lens |
| `lightbox.glass` | `#121917` | the lightbox surface |
| `lightbox.near` | `#1a2421` | light spilling around the lens |
| `film.base` | `#070a09` | unexposed film between and around frames |
| `film.frame` | `#131c19` | a frame's picture area, unlit |
| `film.perf` | `#1c2724` | the lightbox seen through a perforation |
| `film.lit` | `#2a3f38` | the picture area under the glass |
| `white` | `#eef3f1` | type and lit detail |
| `soft` | `#c3cfca` | secondary type |
| `muted` | `#8fa099` | tertiary type |
| `pencil` | `#ffd60a` | grease pencil, and the verdict pill |
| `ink` | `#0d1211` | type on pencil yellow |

The surface runs from `#0d1211` to `#1a2421`. Yellow is the only accent and it means a verdict.
Added and removed lines in a patch are told apart by weight and brightness, not by hue.

The far field is darker than the black threshold of `ffmpeg blackdetect`, which the review stage
runs. A frame still never reads as black, because the lit glass is in every frame and covers far
more than the two percent of pixels that check needs. `theme.test.ts` pins the luma of `film.lit`
and the smallest share of the frame the glass may cover.

## Type

| Role | Family | Weights | Floor at 1920×1080 |
|---|---|---|---|
| Display | Unbounded | 300, 600, 800 | 72 px |
| Text | Figtree (Manrope for Cyrillic and Greek, which Figtree lacks) | 500, 600 | 40 px |
| Code | Martian Mono at 75 % width | 400, 500 | 30 px |

Display is for the thing a frame is about: a repo name, a figure, a short quote. Text is for
labels, long quotes and captions. Code is for commands, patches and source references.

Sizes are fitted to measured glyph widths, between the largest size the composition allows and
the floor of the role. Nothing is set below its floor. A string that cannot fit its frame at the
display floor is set in the text face instead of being cut; only when that fails too is it
shortened with an ellipsis.

Two things are texture and not text, and are exempt from the floors: the film's edge print
(`DAILIES SAFETY FILM`, frame numbers) and the lettering engraved on the loupe's rim. They are
there to be recognised, not read.

## Space, radius, stroke

Spacing scale, in px: 4, 8, 12, 16, 24, 32, 48, 72, 112.

Radii: pills and the loupe are fully round; the caption bar is 20 px; a frame's picture area and
the perforations are rounded in proportion to the film (about 1 % of the frame pitch).

The whole strip is tilted two degrees anticlockwise, and so is everything seen through the glass.

## The film strip

A horizontal strip of 35 mm stock: a dark base, a row of rounded perforations along each edge, a
hairline of light on both edges, and picture frames. A full frame is eight perforations long and
landscape; a half-frame is four perforations long and portrait. Each scene's content lives on
frames of the strip.

The strip is one continuous object for the whole reel. A scene frames a stretch of it at its own
magnification, so moving to the next scene is a camera move along the film, not a cut: the strip
advances and scales, the perforations stay in phase. While a scene plays the picture drifts
slowly along the strip.

Frames that carry nothing for the current scene hold greeked content: a few soft bars.

## The loupe

One lens, drawn by one component (`Loupe.tsx`): a clear skirt that refracts the film beneath it,
a knurled barrel, a rim engraved `DAILIES OPTICAL 4× ILLUMINATED LOUPE`, glass with a soft
highlight, and a shadow on the lightbox.

The loupe is a persistent layer of the composition and belongs to no scene. Each scene declares
where the lens rests, how large it is and how the barrel is turned (`lens.ts`). Between scenes
the lens glides from one resting place to the next on a spring; the move starts a little before
the cut and lands after it. What is under the glass is shown enlarged, and it slides through the
glass faster than the lens travels, the way a real loupe passes over print. It comes into focus
as the lens lands.

Text never touches the rim: content is fitted to the chord of the glass at the height of each
line, less a margin.

## Pencil grammar

Four marks, drawn in yellow grease pencil with a wobbling, waxy stroke. They are used everywhere
and nothing else carries these meanings.

| Mark | Meaning |
|---|---|
| a closed ring | verified |
| a cross | contradicted |
| a dashed ring | stale |
| a question mark | unverified |

A mark draws on, as a stroke, while the line it belongs to is spoken. Marks pass behind type,
which keeps a halo of the frame's colour, so a crossed-out quote stays readable.

The verdict of a flagged claim is also set in words on a yellow pill.

## Scenes

**Title.** The lens rests on the repo name, set in display inside the glass. The window label is
set large beside it, with the session and commit counts under it and the wordmark in the corner.
The strip passes behind with greeked frames.

**Prompt.** The lens grows until the glass fills the frame. Through it: `You asked`, the human's
request, and its session reference in code. A short request is set in display; a long one in the
text face.

**Terminal.** One frame per step. A frame carries the command, the decisive part of its output
set large (`2 failed`, `14 passed`), the rest of the result under it, and its source reference.
The lens holds still while the strip advances a frame at a time, so the step being spoken is the
one under the glass and the steps already told sit to its left. A passing step is ringed; a
failing step is crossed. The scene comes to rest on the last step.

**Diff.** The largest lens. Through it: the file name in display with its directory in code, the
added and removed counts, and the patch in code. Added lines sit on a faint band of light at
full strength; removed lines are dimmed. When the patch is longer than the glass, the window
with the most changed lines is shown and the rest is counted.

**Stats.** One half-frame per value, the figure in display over its label. The lens rests on the
first value and shows it enlarged; the others follow to its right. Figures count up as the lens
lands.

**Flag.** On the left, a frame with the agent's quote under `the agent said` and the pencil
through it: a cross for a contradicted claim, a dashed ring around a stale one. Beside it the
lens rests on the recorded reality, which is ringed. The verdict sits between them on a yellow
pill, `CONTRADICTED` or `STALE`, and the source reference is printed on the film's edge under
the quote.

**End.** The repo name; a strip of small frames with one mark per claim, rings for verified,
crosses for flagged, question marks for unverified, in that order, at most 16 with `+n` after
them; under it the three counts in words. The lens rests at the end of the strip over the
wordmark.

## Captions

A captions-only cut shows the line being spoken in a bar at the bottom of the frame: film-base
black, 20 px radius, text face, up to three lines. Every narrated scene moves up to keep that
inset clear. A voiced cut has no bar and uses the full frame.

## Motion

- The lens glide and the film advance between scenes share one spring.
- The strip advances a frame at a time inside the terminal scene.
- Pencil marks draw on with their line; the verdict pill stamps down after its mark.
- Figures count up; content under the glass pulls into focus.
- Everything except the marks has landed before the middle of its scene.

Review stills are taken at the middle of each scene, as the captions cut, with every mark and
every step already landed, so a still shows all a scene will hold.
