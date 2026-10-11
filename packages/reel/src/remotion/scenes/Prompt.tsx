import React from 'react';
import { theme } from '../../theme';
import { glassRoom, linesRoom } from '../lens';
import { FACE } from '../measure';
import { LIMITS, clampEnd, sourceRef } from '../text';
import { GlassBlock, Lines, ROLES, Type, fitRoles, useScene, type SceneParts } from '../ui';

const { color, size, leading, space, layout, dim } = theme;

export const Prompt: SceneParts<'prompt'> = {
  Film: () => null,

  Glass: ({ scene }) => {
    const { shot, bottom } = useScene();
    const room = glassRoom(shot.lens, bottom);
    // Line breaks are flattened: the request is fitted as running text, and a pasted list would outgrow its rows.
    const quote = clampEnd(scene.quote.replace(/\s+/g, ' ').trim(), LIMITS.promptQuote);
    const label = size.text.label * leading.text;
    const ref = size.code.ref * leading.code;
    const fitted = fitRoles(quote, ROLES.prompt, linesRoom(room, label + space.xl, space.xl + ref, layout.measure));
    return (
      <GlassBlock at={room}>
        <Type face={FACE.text} size={size.text.label} tone={color.soft} style={{ height: label, marginBottom: space.xl }}>You asked</Type>
        <Lines fitted={fitted} face={fitted.role.face} leading={fitted.role.type.leading} align="center" />
        <Type face={FACE.code} size={size.code.ref} leading={leading.code} style={{ height: ref, marginTop: space.xl, opacity: dim.faint }}>{sourceRef(scene.entryId)}</Type>
      </GlassBlock>
    );
  },
};
