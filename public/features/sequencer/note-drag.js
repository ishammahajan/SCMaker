export function bindNoteDrag(
  button,
  {
    note,
    remove,
    resize,
    rollBase,
    pointToNote,
    resolveTarget,
    resolveLength,
    overlaps,
    selectNote,
    dropNote,
  },
) {
  let dragStart = null;
  let dragged = false;
  const placeNote = (target) => {
    button.style.gridRow = rollBase + 24 - target.midi + 2;
    button.style.gridColumn = `${target.start + 2} / span ${target.length ?? note.length}`;
  };
  const dragTarget = (event) => {
    const point = pointToNote(event);
    if (!point) return null;
    if (dragStart.resizing) {
      return {
        start: note.start,
        midi: note.midi,
        length: resolveLength(note, point.start + 1 - note.start),
      };
    }
    return resolveTarget(note, point.start - dragStart.stepOffset, point.midi);
  };
  const resetDrag = () => {
    const pointerId = dragStart?.pointerId;
    dragStart = null;
    button.classList.remove('dragging', 'resizing', 'drag-blocked');
    placeNote(note);
    if (pointerId !== undefined && button.hasPointerCapture(pointerId)) {
      button.releasePointerCapture(pointerId);
    }
  };
  button.onpointerdown = (event) => {
    if (dragStart || event.button !== 0 || event.target === remove) return;
    selectNote();
    const grabbed = pointToNote(event);
    dragStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      stepOffset: grabbed ? grabbed.start - note.start : 0,
      resizing: event.target === resize,
    };
    dragged = false;
    button.setPointerCapture(event.pointerId);
  };
  button.onpointermove = (event) => {
    if (!dragStart || event.pointerId !== dragStart.pointerId) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    if (!dragged && Math.hypot(dx, dy) < 4) return;
    dragged = true;
    const target = dragTarget(event);
    const blocked =
      !target || overlaps(note, target.start, target.midi, target.length ?? note.length);
    button.classList.add('dragging');
    button.classList.toggle('resizing', dragStart.resizing);
    button.classList.toggle('drag-blocked', blocked);
    placeNote(blocked ? note : target);
  };
  button.onpointerup = (event) => {
    if (!dragStart || event.pointerId !== dragStart.pointerId) return;
    const target = dragged ? dragTarget(event) : null;
    resetDrag();
    if (target) dropNote(target);
  };
  const cancelDrag = (event) => {
    if (event.pointerId === dragStart?.pointerId) resetDrag();
  };
  button.onpointercancel = cancelDrag;
  button.onlostpointercapture = cancelDrag;

  return { wasDragged: () => dragged };
}
