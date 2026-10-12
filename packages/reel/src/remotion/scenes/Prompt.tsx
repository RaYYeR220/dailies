import { theme } from '../../theme';
import { glassRoom, linesRoom, type LensRest } from '../lens';
import { FACE } from '../measure';
import { promptShown, sourceRef } from '../text';
import { GlassBlock, Lines, ROLES, Type, fitRoles, useScene, type SceneOf, type SceneParts } from '../ui';

const { color, size, leading, space, layout, dim, shot } = theme;

const LABEL = size.text.label * leading.text;
const REF = size.code.ref * leading.code;

/**
 * The request as the glass shows it: what `promptShown` leaves of it, fitted in a glass that keeps the prompt's
 * own margin clear inside the rim. `above` and `below` are what the block holds over and under the lines.
 */
export function layoutPrompt(scene: SceneOf<'prompt'>, lens: LensRest, bottom: number) {
  const room = glassRoom(lens, bottom, shot.prompt.rim);
  const above = LABEL + space.xl;
  const below = space.xl + REF;
  return { room, above, below, fitted: fitRoles(promptShown(scene.quote), ROLES.prompt, linesRoom(room, above, below, layout.measure)) };
}

export const Prompt: SceneParts<'prompt'> = {
  Film: () => null,

  Glass: ({ scene }) => {
    const m = useScene();
    const { room, fitted } = layoutPrompt(scene, m.shot.lens, m.bottom);
    return (
      <GlassBlock at={room}>
        <Type face={FACE.text} size={size.text.label} tone={color.soft} style={{ height: LABEL, marginBottom: space.xl }}>You asked</Type>
        <Lines fitted={fitted} face={fitted.role.face} leading={fitted.role.type.leading} align="center" />
        <Type face={FACE.code} size={size.code.ref} leading={leading.code} style={{ height: REF, marginTop: space.xl, opacity: dim.faint }}>{sourceRef(scene.entryId)}</Type>
      </GlassBlock>
    );
  },
};
