// The storybook world.js as it was before the survivor-style hook
// (art/frisson/SURVIVORS.md section 10, claude/frisson 8cc714b): today's
// source with each hook line put back as it was. Tests load it as a second
// world.js and compare its survivors and raiders with today's, so the hook
// is proven transparent while the rest of the file keeps evolving. Each
// pair must match exactly once: if you change a hook line on purpose,
// update its pair here.
const PAIRS = [
  [`// The same pivot without its box, for a survivor style to fill.
function joint(parent,x,y,z) {
  const pivot=new THREE.Group();pivot.position.set(x,y,z);parent.add(pivot);return pivot;
}
`, ''],
  [`// The players' look may come from a style installed at runtime (the Frisson
// survivors, art/frisson/SURVIVORS.md); null is the storybook survivor
// below. style.plan({ color, identity, raider }) answers for a whole
// survivor or for none (null). With a plan, createSurvivor still makes,
// names, places and orders every group and pivot and asks the style for the
// meshes where it would build boxes: style.buildTorso(body, plan) adds the
// torso first and returns { torso, vest }, buildHips(body, plan) { belt },
// buildHead(head, plan, { glow }), buildLeg(leg, knee, plan, { side })
// { boot } (on the knee), buildArm(arm, plan, { side }) { hand }. A style
// missing a builder is no style. Styled meshes share the style's geometry;
// their hands keep their true size on stretched arms (userData.hands).
let survivorStyle = null;
const SURVIVOR_BUILDERS = Object.freeze(['plan', 'buildHead', 'buildTorso', 'buildHips', 'buildArm', 'buildLeg']);
export function setSurvivorStyle(style = null) { survivorStyle = style ?? null; }
export function getSurvivorStyle() { return survivorStyle; }
function survivorPlan(color, identity, raider) {
  const style = survivorStyle;
  if (!style || !SURVIVOR_BUILDERS.every(name => typeof style[name] === 'function')) return null;
  const plan = style.plan({ color, identity, raider }) ?? null;
  return plan ? { style, plan } : null;
}
// A deep green glow stays green after tone mapping instead of washing out.
function raiderGoggleMaterial() { return material('raiderGoggles',RAIDER_APPEARANCE.accentColor,.35,{emissive:0x0b8a50,emissiveIntensity:2.1}); }

// identity: { id, name, companion, look } of the snapshot player (null in tools).
export function createSurvivor(color=0x6299a2,{backpack:packed=true,weapon='pistol',identity=null,raider=false}={}) {
  const styled=survivorPlan(color,identity,raider),style=styled?.style,plan=styled?.plan;
  const survivor=new THREE.Group();const clothes=styled?null:new THREE.MeshStandardMaterial({color,roughness:.9});
`, `export function createSurvivor(color=0x6299a2,{backpack:packed=true,weapon='pistol'}={}) {
  const survivor=new THREE.Group();const clothes=new THREE.MeshStandardMaterial({color,roughness:.9});
`],
  [`  const {torso,vest}=styled?style.buildTorso(body,plan):{torso:box(body,0,1.17,0,.46,.57,.28,clothes),vest:box(body,0,1.2,-.17,.35,.45,.07,material('vest',0x293738))};`,
    `  const torso=box(body,0,1.17,0,.46,.57,.28,clothes),vest=box(body,0,1.2,-.17,.35,.45,.07,material('vest',0x293738));`],
  [`  const belt=styled?style.buildHips(body,plan).belt:box(body,0,.9,0,.42,.08,.26,material('belt',0x2a2420));`,
    `  const belt=box(body,0,.9,0,.42,.08,.26,material('belt',0x2a2420));`],
  [`  if(styled)style.buildHead(head,plan,{glow:raider?raiderGoggleMaterial():null});
  else{sphere(head,0,0,0,.19,skin,.9,1.1,.9);sphere(head,0,.09,.015,.195,cap,1,.6,1).name='survivorCap';
    box(head,0,.07,-.2,.21,.025,.13,cap).name='survivorBrim';
    head.add(survivorFace());}
  const knees=[],boots=[],hands=[];
  const legs=[-1,1].map(side=>{
    if(styled){const leg=joint(body,side*.13,.9,0),knee=joint(leg,0,-.38,0);knees.push(knee);boots.push(style.buildLeg(leg,knee,plan,{side}).boot);return leg;}
    const leg=limb(body,side*.13,.9,0,.18,.38,pants),knee=limb(leg,0,-.38,0,.17,.35,pants);knees.push(knee);boots.push(box(knee,0,-.38,-.05,.2,.1,.29,material('boots',0x221e1b)));return leg;});`,
  `  sphere(head,0,0,0,.19,skin,.9,1.1,.9);sphere(head,0,.09,.015,.195,cap,1,.6,1).name='survivorCap';
  box(head,0,.07,-.2,.21,.025,.13,cap).name='survivorBrim';
  head.add(survivorFace());
  const knees=[],boots=[];
  const legs=[-1,1].map(side=>{const leg=limb(body,side*.13,.9,0,.18,.38,pants),knee=limb(leg,0,-.38,0,.17,.35,pants);knees.push(knee);boots.push(box(knee,0,-.38,-.05,.2,.1,.29,material('boots',0x221e1b)));return leg;});`],
  [`  const arms=[-1,1].map(side=>{
    if(styled){const arm=joint(aim,side*.24,0,0);hands.push(style.buildArm(arm,plan,{side}).hand);return arm;}
    const arm=limb(aim,side*.24,0,0,.13,ARM_LENGTH-.06,clothes);box(arm,0,-ARM_LENGTH+.03,0,.12,.11,.13,skin);return arm;});`,
  `  const arms=[-1,1].map(side=>{const arm=limb(aim,side*.24,0,0,.13,ARM_LENGTH-.06,clothes);box(arm,0,-ARM_LENGTH+.03,0,.12,.11,.13,skin);return arm;});`],
  [`  if(styled)Object.assign(survivor.userData,{hands,character:plan.character});
`, ''],
  [`// zombie-eye program), with no light and no shadow. A survivor style dresses
// its own raiders (hood, mask, goggles, armband, back mark): then none of this.
function dressRaider(d) {
`, `// zombie-eye program), with no light and no shadow.
export function createRaider({weapon='smg',maxHp}={}) {
  const raider=createSurvivor(RAIDER_APPEARANCE.clothColor,{backpack:false,weapon:null}),d=raider.userData;
`],
  [`  const goggles=raiderGoggleMaterial();`, `  // A deep green glow stays green after tone mapping instead of washing out.
  const goggles=material('raiderGoggles',RAIDER_APPEARANCE.accentColor,.35,{emissive:0x0b8a50,emissiveIntensity:2.1});`],
  [`}
// id: the raider's server id, for a style's pick (null in tools).
export function createRaider({weapon='smg',maxHp,id=null}={}) {
  const raider=createSurvivor(RAIDER_APPEARANCE.clothColor,{backpack:false,weapon:null,raider:true,identity:id===null?null:{id}}),d=raider.userData;
  if(!d.character)dressRaider(d);
`, ''],
  [`    if(d.hands)for(const hand of d.hands)hand.scale.y=1;
`, ''],
  [`  // A styled survivor's hands keep their true size on the stretched arms.
  if(d.hands)d.hands.forEach((hand,index)=>{hand.scale.y=1/d.arms[index].scale.y;});
`, ''],
];

export function withoutSurvivorStyleHook(source) {
  let text = source.replace(/\r\n/g, '\n');
  for (const [hook, original] of PAIRS) {
    const found = text.split(hook).length - 1;
    if (found !== 1) throw new Error(`world.js survivor hook found ${found} times, expected 1: ${hook.split('\n')[0]}`);
    text = text.split(hook).join(original);
  }
  return text;
}
