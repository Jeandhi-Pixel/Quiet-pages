'use strict';
/* Quiet Spaces exercise guidance. The diagrams are original, simplified
   SVG stick figures, bundled for offline use. Nothing is uploaded. */
const ExerciseGuide = (() => {
  const guides = Object.freeze({
    'Glute bridges': {
      description:'Lie on your back, knees bent and feet flat. Press through your feet to lift your hips, then lower slowly.',
      cues:['Feet about hip-width apart.','Keep knees pointing in line with your feet.','Squeeze the glutes as you rise.','Lower with control.'],
      avoid:'Avoid thrusting your ribs upward or over-arching your lower back.',
      phases:['Start','Lift hips'],
      sketch:[
        '<circle cx="24" cy="88" r="8"/><path d="M32 88 L48 84 L82 84 L104 49 L122 90 L135 90"/><path d="M52 85 L47 102"/><path d="M10 112H147"/>',
        '<circle cx="24" cy="88" r="8"/><path d="M32 88 L48 84 L84 55 L109 55 L124 90 L137 90"/><path d="M48 84 L45 101"/><path d="M10 112H147"/><path class="motion" d="M82 89 Q73 69 84 61"/><path class="motion" d="m79 68 5-7 6 6"/>'
      ]
    },
    'Reverse lunges': {
      description:'Stand tall, step one foot backward and lower both knees with control. Push through your front foot to stand again.',
      cues:['Maintain a comfortable stance width.','Keep the front knee aligned with the foot.','Lower straight down rather than pitching forward.','Alternate legs.'],
      avoid:'Avoid collapsing the front knee inward or stepping so narrowly that you lose balance.',
      phases:['Stand','Step back'],
      sketch:[
        '<circle cx="78" cy="20" r="10"/><path d="M78 31 L78 65 M78 41 L56 57 M78 41 L100 57 M78 65 L67 88 L66 109 M78 65 L90 88 L91 109 M54 109 L76 109 M80 109 L102 109"/><path d="M10 112H147"/>',
        '<circle cx="76" cy="20" r="10"/><path d="M76 31 L76 60 M76 41 L55 58 M76 41 L98 58 M76 60 L52 83 L43 109 M76 60 L113 85 L125 109 M31 109 L54 109 M118 109 L144 109"/><path d="M10 112H147"/><path class="motion" d="M120 65 Q131 75 125 93"/><path class="motion" d="m120 85 5 8 7-6"/>'
      ]
    },
    'Side-lying hip abductions': {
      description:'Lie on one side with your hips stacked. Keeping your top leg straight, raise it slowly, then lower without swinging.',
      cues:['Support your head comfortably.','Keep your hips stacked, one over the other.','Point the toes mostly forward.','Move slowly; a small lift is enough.'],
      avoid:'Avoid rolling backward or turning the toes toward the ceiling.',
      phases:['Legs together','Lift top leg'],
      sketch:[
        '<circle cx="31" cy="81" r="9"/><path d="M39 81 L56 79 L88 85 L132 89 M88 85 L133 84 M50 81 L50 105 M50 105 L35 106"/><path d="M10 112H147"/>',
        '<circle cx="31" cy="81" r="9"/><path d="M39 81 L56 79 L88 85 L132 91 M88 85 L132 48 M50 81 L50 105 M50 105 L35 106"/><path d="M10 112H147"/><path class="motion" d="M134 82 Q142 69 132 57"/><path class="motion" d="m132 65 0-9 9 3"/>'
      ]
    },
    'Plank': {
      description:'Place your forearms under your shoulders and extend your legs. Hold a steady line from head through hips to heels.',
      cues:['Elbows roughly beneath your shoulders.','Gently brace your stomach and glutes.','Keep hips in line with the torso.','Breathe normally throughout the hold.'],
      avoid:'Avoid letting your hips sag or raising them high into a pike.',
      phases:['Set position','Hold steady'],
      sketch:[
        '<circle cx="34" cy="46" r="9"/><path d="M43 48 L76 65 L126 87 L137 108 M61 56 L58 96 L42 96 M121 86 L132 106"/><path d="M10 112H147"/>',
        '<circle cx="34" cy="46" r="9"/><path d="M43 48 L76 65 L126 87 L137 108 M61 56 L58 96 L42 96 M121 86 L132 106"/><path d="M10 112H147"/><path class="guide" d="M41 40 L140 104"/>'
      ]
    },
    'Dead bugs': {
      description:'Lie on your back with arms toward the ceiling and knees bent. Slowly extend one arm and the opposite leg, then return and switch sides.',
      cues:['Keep your ribs relaxed and torso stable.','Move the opposite arm and leg together.','Exhale as you extend.','Shorten the reach if your back starts arching.'],
      avoid:'Avoid rushing or forcing your lower back to lift away from the floor.',
      phases:['Arms and knees up','Opposite reach'],
      sketch:[
        '<circle cx="29" cy="90" r="9"/><path d="M38 90 L57 90 L87 90 M59 90 L60 39 M88 90 L110 50 L128 52 M87 90 L112 62 L132 65"/><path d="M10 112H147"/>',
        '<circle cx="29" cy="90" r="9"/><path d="M38 90 L57 90 L87 90 M59 90 L23 48 M87 90 L111 94 L141 94 M87 90 L112 52 L128 55"/><path d="M10 112H147"/><path class="motion" d="M54 49 Q41 45 28 53 M118 72 Q135 77 141 88"/><path class="motion" d="m31 45-5 8 9 1 m98 31 8 4-1-9"/>'
      ],
      note:'Simplified side view: in practice, extend opposite limbs.'
    },
    'Gentle yoga': {
      description:'Spend about 15 minutes moving through comfortable stretches and calm breathing. Cat–cow is one optional example.',
      cues:['Keep breathing throughout each movement.','Move through a comfortable range.','Rest or modify poses when needed.','Aim for relaxation, not maximum stretch.'],
      avoid:'Avoid pushing into pain or forcing your joints into position.',
      phases:['Cat (round back)','Cow (gentle arch)'],
      sketch:[
        '<circle cx="115" cy="72" r="9"/><path d="M107 74 Q86 39 57 64 L43 100 M99 65 L100 105 M57 64 L58 105 M10 112H147"/>',
        '<circle cx="115" cy="67" r="9"/><path d="M107 71 Q83 94 57 68 L43 102 M98 82 L100 105 M57 68 L57 105 M10 112H147"/>'
      ],
      note:'The sketch illustrates one possible yoga movement, not the entire session.'
    }
  });
  const E=(tag,cls,value)=>{
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(value!==undefined)n.textContent=value;
    return n;
  };
  function draw(guide,name){
    const frame=E('div','spaces-motion');
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 338 118');
    svg.setAttribute('role','img');
    svg.setAttribute('aria-label',name+' motion, first position and second position');
    // All SVG markup comes exclusively from the static sketches above.
    svg.innerHTML='<g class="spaces-figure" transform="translate(0 0)">'+guide.sketch[0]+
      '</g><path class="spaces-motion-between" d="M157 62h22m-6-6 6 6-6 6"/>'+
      '<g class="spaces-figure" transform="translate(187 0)">'+guide.sketch[1]+'</g>';
    frame.append(svg);
    const captions=E('div','spaces-motion-captions');
    captions.append(E('span','',guide.phases[0]),E('span','',guide.phases[1]));
    frame.append(captions);
    return frame;
  }
  function panel(name){
    const guide=guides[name];if(!guide)return null;
    const box=E('div','spaces-exercise-guide');
    box.append(E('p','spaces-guide-summary',guide.description),draw(guide,name));
    const title=E('strong','spaces-guide-label','Key cues');
    box.append(title);
    const list=E('ul','spaces-guide-cues');
    guide.cues.forEach(item=>list.append(E('li','',item)));
    box.append(list);
    const warning=E('p','spaces-guide-warning');
    const strong=E('strong','','Avoid: ');
    warning.append(strong,document.createTextNode(guide.avoid));
    box.append(warning);
    if(guide.note)box.append(E('p','spaces-guide-note',guide.note));
    return box;
  }
  return Object.freeze({panel,has:name=>Object.hasOwn(guides,name),names:()=>Object.keys(guides)});
})();
