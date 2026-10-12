export function menuAction(state={}) {
 if(!state.hasSelection)return 'page';
 if(state.hasSelection&&(state.selectionUnannotated||!state.hasAnnotations))return 'selection';
 return state.hasAnnotations?'undo':'page';
}
