/**
 * Métrica da Inter Bold (assets/fonts/Inter-Bold.otf) para medir texto sem
 * renderizar. No libass, Fontsize = winAscent + winDescent, então 1 em equivale
 * a 0,8264 × Fontsize. Conferido: "HAMBURGUER" com fs 100 mede 597 px no
 * cálculo e 597 px renderizado.
 */

// Avanço de cada caractere em em (unidades da fonte / 2048).
const INTER_BOLD_ADV: Record<string, number> = {" ":0.237,"!":0.338,"\"":0.552,"#":0.649,"$":0.655,"%":1.016,"&":0.672,"'":0.339,"(":0.377,")":0.377,"*":0.559,"+":0.679,",":0.334,"-":0.468,".":0.334,"/":0.388,"0":0.674,"1":0.431,"2":0.63,"3":0.646,"4":0.676,"5":0.639,"6":0.649,"7":0.582,"8":0.651,"9":0.649,":":0.334,";":0.343,"<":0.679,"=":0.679,">":0.679,"?":0.56,"@":1.016,"A":0.747,"B":0.662,"C":0.74,"D":0.722,"E":0.607,"F":0.587,"G":0.75,"H":0.747,"I":0.281,"J":0.584,"K":0.719,"L":0.565,"M":0.932,"N":0.762,"O":0.771,"P":0.648,"Q":0.777,"R":0.657,"S":0.655,"T":0.667,"U":0.732,"V":0.747,"W":1.038,"X":0.738,"Y":0.731,"Z":0.664,"a":0.581,"b":0.63,"c":0.588,"d":0.63,"e":0.596,"f":0.398,"g":0.632,"h":0.623,"i":0.271,"j":0.271,"k":0.58,"l":0.271,"m":0.913,"n":0.623,"o":0.613,"p":0.63,"q":0.63,"r":0.407,"s":0.56,"t":0.366,"u":0.623,"v":0.6,"w":0.85,"x":0.58,"y":0.602,"z":0.573,"À":0.747,"Á":0.747,"Â":0.747,"Ã":0.747,"Ç":0.74,"É":0.607,"Ê":0.607,"Í":0.281,"Ó":0.771,"Ô":0.771,"Õ":0.771,"Ú":0.732,"Ü":0.732,"à":0.581,"á":0.581,"â":0.581,"ã":0.581,"ç":0.588,"é":0.596,"ê":0.596,"í":0.271,"ó":0.613,"ô":0.613,"õ":0.613,"ú":0.623,"ü":0.623,"€":0.685,"–":0.5,"—":1.0,"°":0.459,"º":0.482,"ª":0.484};

export const EM_PER_FS = 1 / (0.96875 + 0.2412109375);
/** Altura das maiúsculas, ascendente e descendente, em em. */
export const CAP_HEIGHT = 0.7275;
export const ASCENT = 0.96875;
export const DESCENT = 0.2412;

/** Largura (px) do texto em Inter Bold no corpo `fontSize` do libass. */
export function measureText(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) width += INTER_BOLD_ADV[ch] ?? 0.62;
  return width * fontSize * EM_PER_FS;
}
