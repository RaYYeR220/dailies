import { theme } from '../../theme';
import { MAX_STEPS, cueFrame, stepAt, stepSpans } from '../cues';
import { OnFrame } from '../Film';
import { glassRoom, linesRoom } from '../lens';
import { Mark } from '../marks';
import { FACE, emOf } from '../measure';
import { frameBox, stripOf } from '../strip';
import { BREAKS, LIMITS, boxRoom, clampEnd, clampWidth, decisive, fitText, type Decisive } from '../text';
import { GlassBlock, Lines, ROLES, Type, fitRef, fitRoles, heightOf, ringOf, useScene, widthOf, type Room, type SceneOf, type SceneParts } from '../ui';

const { color, size, leading, space, film, loupe, motion } = theme;

const COMMAND_LINES = 2;
// A cross takes this share of the frame it rejects; a ring stands this far off the result it selects, in em.
const CROSS = { width: 1.04, height: 0.74 };
const RING = { x: 0.34, y: 0.42, min: 30 };
const RING_RIM = 36;   // extra margin a result keeps from the rim of the glass, so its ring stays on the glass
// Under the glass the cross is struck through the result alone: this much wider and taller than it.
const STRUCK = { width: 1.3, height: 2.3 };
const GAP = space.xxl + space.xs;   // between the command and the result under the glass: room for the ring to pass

/** The steps of the scene with what each comes down to, and when its mark is drawn. */
function useSteps(scene: SceneOf<'terminal'>) {
  const m = useScene();
  const steps = scene.steps.slice(0, MAX_STEPS);
  const spans = stepSpans(steps.map((s) => s.entryId), scene.lines, m.lines, m.duration);
  const advance = motion.stepSec * m.fps;
  return {
    m,
    position: stepAt(scene, m.lines, m.frame, m.duration, m.fps, m.settled),
    steps: steps.map((step, i) => ({
      ok: step.ok,
      command: `$ ${step.command.replace(/\s+/g, ' ').trim()}`,
      result: decisive(clampEnd(step.output, LIMITS.output), step.ok, step.headline),
      entryId: step.entryId,
      // The pencil waits for the lens: after the landing for the first step, after the strip has moved on for the others.
      cue: cueFrame(spans[i]!, m.fps, i === 0 ? m.landing : spans[i]!.start + advance),
    })),
  };
}

/** The decisive part of a step's output, fitted: a count in display, a line of output in code. */
const fitResult = (result: Decisive, room: Room) =>
  result.kind === 'line' ? fitRoles(result.headline, ROLES.output, room, { maxLines: 3, soft: BREAKS.name }) : fitRoles(result.headline, ROLES.result, room, { maxLines: 2, fewest: true });

/** How far a ring stands off a result set at `size` px. */
const ringPad = (size: number) => ({ x: Math.max(RING.min, RING.x * size), y: Math.max(RING.min, RING.y * size) });

export const Terminal: SceneParts<'terminal'> = {
  Film: ({ scene }) => {
    const { m, steps, position } = useSteps(scene);
    const strip = stripOf(m.shot.unit, m.shot.half);
    const box = frameBox(strip, m.shot.at, 0);
    const pad = m.shot.unit * film.padding;
    // The skirt of the lens lies over the far end of the step before the one it rests on. Every step is set to
    // the width that stays clear there, so its text holds still when the strip moves it on.
    const width = Math.min(box.width - 2 * pad, -loupe.skirt.outer * m.shot.lens.scale - frameBox(strip, m.shot.at, -1).left - pad - space.xxl);
    const row = size.code.ref * leading.code;
    const detail = size.text.detail * leading.text;
    return (
      <>
        {steps.map((step, i) => {
          const room = box.height - 2 * pad - 2 * row - space.md - (step.result.detail ? detail : 0);
          const head = fitResult(step.result, boxRoom(width, room));
          const drawn = m.drawn(step.cue);
          // Type under a cross keeps a halo, so the pencil passes behind it.
          const halo = step.ok ? undefined : color.film.frame;
          return (
            // A step still to come stays dark until the strip brings it under the lens.
            <OnFrame key={i} k={i} style={{ opacity: i <= position + 0.5 ? 1 : 0 }}>
              {step.ok ? null : <Mark kind="cross" x={pad + width / 2} y={box.height / 2} width={width * CROSS.width} height={box.height * CROSS.height} seed={i + 3} progress={drawn} />}
              <div style={{ position: 'absolute', left: pad, top: pad, width }}>
                <Type face={FACE.code} size={size.code.ref} leading={leading.code} tone={color.muted} halo={halo} style={{ marginBottom: space.md }}>{clampWidth(step.command, width / size.code.ref, emOf(FACE.code))}</Type>
                <div style={{ position: 'relative', width: 'fit-content' }}>
                  <Lines fitted={head} face={head.role.face} leading={head.role.type.leading} halo={halo} />
                  {step.ok ? <Mark kind="ring" x={widthOf(head, head.role.face) / 2} y={heightOf(head) / 2} {...ringOf(head, head.role.face, head.role.type.leading, ringPad(head.size))} seed={i + 11} progress={drawn} /> : null}
                </div>
                {step.result.detail ? <Type face={FACE.body} size={size.text.detail} tone={color.muted} halo={halo}>{step.result.detail}</Type> : null}
              </div>
              <Type face={FACE.code} size={size.code.ref} leading={leading.code} tone={color.muted} halo={halo} style={{ position: 'absolute', left: pad, bottom: pad - space.sm }}>{fitRef(step.entryId, width)}</Type>
            </OnFrame>
          );
        })}
      </>
    );
  },

  Glass: ({ scene }) => {
    const { m, steps, position } = useSteps(scene);
    const room = glassRoom(m.shot.lens, m.bottom);
    const ringed = glassRoom(m.shot.lens, m.bottom, loupe.rim + RING_RIM);
    const strip = stripOf(m.shot.unit, m.shot.half);
    const command = { max: size.code.command, min: size.code.command, leading: leading.code };
    const detail = size.text.detail * leading.text;
    return (
      <>
        {steps.map((step, i) => {
          // Each step is its own frame under the glass; only the one the lens is on, or is moving to, is in sight.
          if (Math.abs(i - position) >= 1) return null;
          const below = step.result.detail ? detail + space.xs : 0;
          const head = fitResult(step.result, linesRoom(ringed, COMMAND_LINES * command.max * command.leading + GAP, below));
          const typed = fitText(step.command, command, linesRoom(room, 0, GAP + heightOf(head) + below), emOf(FACE.code), { maxLines: COMMAND_LINES });
          const drawn = m.drawn(step.cue);
          const [w, h] = [widthOf(head, head.role.face), heightOf(head)];
          const halo = step.ok ? undefined : color.film.lit;
          return (
            <div key={i} style={{ position: 'absolute', left: i * strip.pitch * loupe.parallax, top: 0, width: 0, height: 0 }}>
              <GlassBlock at={room}>
                <Lines fitted={typed} face={FACE.code} leading={command.leading} align="center" tone={color.soft} halo={halo} style={{ position: 'relative', marginBottom: GAP }} />
                <div style={{ position: 'relative' }}>
                  {step.ok ? null : <Mark kind="cross" x={w / 2} y={h / 2} width={w * STRUCK.width} height={h * STRUCK.height} seed={i + 3} progress={drawn} />}
                  <Lines fitted={head} face={head.role.face} leading={head.role.type.leading} align="center" halo={halo} style={{ position: 'relative' }} />
                  {step.ok ? <Mark kind="ring" x={w / 2} y={h / 2} {...ringOf(head, head.role.face, head.role.type.leading, ringPad(head.size))} seed={i + 11} progress={drawn} /> : null}
                </div>
                {step.result.detail ? <Type face={FACE.body} size={size.text.detail} tone={color.soft} halo={halo} style={{ position: 'relative', height: detail, marginTop: space.xs }}>{step.result.detail}</Type> : null}
              </GlassBlock>
            </div>
          );
        })}
      </>
    );
  },
};
