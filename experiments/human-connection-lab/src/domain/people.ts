/**
 * The simulated people of the demo world.
 *
 * These are invented characters, not real people, and the product says so on
 * screen. Each has a distinct voice and pre-written answers to every question,
 * so a whole conversation with any of them reads as one person talking. They
 * cannot read what the visitor writes — that limit is stated in the app.
 *
 * When the visitor replies under one of their halves, they answer once with a
 * continuation of their own answer (see continuations.ts). They do not read
 * the reply: the continuation is written to follow from "tell me more".
 */

export interface Persona {
  id: string;
  city: string;
  firstName: string;
  work: string;
  /**
   * How many extra rounds this person takes before knocking on a door.
   * Some people open up more slowly than others; the demo shows that too.
   */
  reserve?: number;
  /** Local time at which they wrote each daily answer, by daily question id. */
  wroteAt: Record<string, string>;
  /** Answers keyed by question id — every daily and chapter question. */
  answers: Record<string, string>;
}

export const PEOPLE: readonly Persona[] = [
  {
    id: 'mira',
    city: 'Lisbon',
    firstName: 'Mira',
    work: 'Restores old tile panels in Lisbon',
    wroteAt: { 'd-noticed': '08:12', 'd-nine': '21:40', 'd-proud': '07:55', 'd-place': '19:05' },
    answers: {
      'd-noticed':
        'The man who sells chestnuts on my corner has started wearing a flower in his cap. Nobody has said anything. I think it’s for someone.',
      'd-nine':
        'A lighthouse keeper. I restore tiles now, which is also mostly about keeping old things from disappearing, so I think nine-year-old me would accept it.',
      'd-proud':
        'I can tell which century a blue is from just by looking at it. It has never once been useful at a party.',
      'd-place':
        'My grandmother’s kitchen in Évora, in August, shutters half closed. Everything was slow and nobody needed me to be interesting.',
      'l-morning':
        'Coffee standing at the counter downstairs, two minutes of gossip with the owner, then the walk to the workshop before the trams get loud.',
      'l-laugh':
        'A pigeon walked into the workshop, looked for a long time at a panel I’ve spent three weeks on, and left. I felt reviewed.',
      'l-skill': 'Whistling with two fingers. My brother can do it and has held it over me for thirty years.',
      'l-food':
        'Caldo verde tastes like my father — specifically my father being worried about me and not saying so.',
      'c-changed':
        'I used to think starting over was a kind of failure. I left a stable job at thirty-four to apprentice with an old man who barely spoke. Best thing I ever did.',
      'c-taught':
        'That old man. Senhor Abílio never explained anything; he just waited until I noticed what I’d done wrong. Patience as a teaching method.',
      'c-week':
        'Half my week is on scaffolding outside churches, talking to whoever walks by. People tell you remarkable things when you’re up a ladder and can’t leave.',
      'c-ease': 'When we’re doing something with our hands — cooking, fixing, carrying. Talking is easier sideways than face to face.',
      'p-forgive':
        'My mother, for being so careful with her love that I spent years thinking there wasn’t enough of it. I understand her more each year. Forgiving is slower than understanding.',
      'p-hope':
        'That something I repair will still be on a wall in two hundred years, and someone will stop and look at it for no reason at all.',
      'p-friend':
        'Remember the small thing you said once and ask about it weeks later. It costs nothing and it means everything.',
      'p-hard':
        'The workshop might lose its lease. What helped was saying it out loud to a few people instead of carrying it around like a secret.',
      'l-place': "The viewpoint behind my building at dusk. Not the famous one — the small one with a broken bench where the old men play cards.",
      'l-sound': "The tram bell on the hill outside my window. Two rings means the driver knows someone at the stop.",
      'c-habit': "Kept: I still count stairs under my breath. Dropped: apologising for taking up space in a room.",
      'c-evening': "Sardines on the balcony, a radio playing fado too quietly to really hear, and no plans for the next morning.",
      'p-unsure': "I thought I was someone who needed everyone to approve of what I did. Turns out I only needed one old man to nod once.",
      'p-thanks': "The woman at the job centre who read my CV, saw “pottery, age twelve” at the bottom, and asked why I wasn’t doing that.",
    },
  },
  {
    id: 'tomasz',
    city: 'Kraków',
    firstName: 'Tomasz',
    work: 'Night-shift nurse in Kraków',
    wroteAt: { 'd-noticed': '04:10', 'd-nine': '05:22', 'd-proud': '03:48', 'd-place': '06:15' },
    answers: {
      'd-noticed':
        'At four in the morning the hospital vending machine hums a slightly different note. I’ve told three colleagues. None of them can hear it. I may not be well.',
      'd-nine':
        'An astronaut. Now I work nights and see more of the moon than most astronauts do, so: partial success.',
      'd-proud': 'In eleven years I’ve never lost my temper with a patient. Some of them have really tried.',
      'd-place':
        'A train between Kraków and Zakopane, window seat, nobody I know on board. Being in between places suits me.',
      'l-morning':
        'My mornings are other people’s evenings. A good one: shift ends, bakery opens, I’m the first customer, I eat the bread on the tram.',
      'l-laugh':
        'My cat knocked my phone into a bowl of soup and then looked at me as if I had done it. Which, by owning a cat, I suppose I had.',
      'l-skill':
        'The accordion. My grandfather played at every wedding in the village. It skipped a generation and then, apparently, skipped me too.',
      'l-food':
        'Pierogi with sauerkraut taste like my aunt Halina, who made hundreds every Christmas and complained about it with enormous joy.',
      'c-changed':
        'I thought being tough meant not being affected. Night shifts cured me of that. Now I think tough means being affected and coming back anyway.',
      'c-taught':
        'A patient, actually. An old man with almost nothing left who thanked every single person who came into his room. Every single one.',
      'c-week':
        'Mornings I sleep, afternoons I swim, and twice a week I teach first aid to teenagers who mostly want to practise on each other’s very dramatic fake injuries.',
      'c-ease': 'At three in the morning in the break room, when everyone is too tired to pretend. The most honest conversations of my life.',
      'p-forgive':
        'Myself, for the years I was too proud to ask anyone how they were really doing. I thought it was respect. It was just distance.',
      'p-hope': 'That one day I’ll live somewhere with a garden and have people over on Sundays, and the house will be loud.',
      'p-friend': 'Show up without being asked. Not with advice. With soup, or a lift, or by just sitting there.',
      'p-hard':
        'We lost a young patient last month. What helped was a colleague who didn’t say anything wise. She just walked me home.',
      'l-place': "A cheap canteen near the station where the soup costs almost nothing and the cook still shouts orders like it’s 1985.",
      'l-sound': "The pigeons on my windowsill at dawn when I get home. They sound like they’re complaining about my shift.",
      'c-habit': "Kept: I always fold my socks in pairs, the way my mother taught me. Dropped: pretending I’m not tired.",
      'c-evening': "I don’t get many evenings — I work them. When I do, I cook something slow and call my sister and we say very little.",
      'p-unsure': "That I was calm. I’m not calm. I’m just good at being calm for other people.",
      'p-thanks': "A senior nurse called Danuta who covered for me on my first night, when I froze. She never mentioned it again.",
    },
  },
  {
    id: 'nkechi',
    city: 'Lagos',
    firstName: 'Nkechi',
    work: 'Software tester in Lagos who sings alto in a choir',
    wroteAt: { 'd-noticed': '13:30', 'd-nine': '22:02', 'd-proud': '20:45', 'd-place': '07:18' },
    answers: {
      'd-noticed':
        'The bus driver near my office has a laminated sign that says “Patience is also a fare.” It has been there for years. I only read it on Tuesday.',
      'd-nine':
        'A newscaster. I practised in the mirror with a hairbrush. I test software now, which is also announcing bad news, just to engineers.',
      'd-proud':
        'I sing alto in a choir, and last December I held a note so long the conductor laughed out loud in the middle of the concert. I think about it weekly.',
      'd-place':
        'Choir practice on Thursday nights. Thirty people, terrible fans, everyone sweating, and for two hours nobody looks at a phone.',
      'l-morning':
        'Leftover jollof for breakfast, a voice note to my sister, and fifteen minutes of singing in the car in traffic — the only reason traffic is survivable.',
      'l-laugh':
        'I found a bug report I wrote at 2am that just said “button is behaving with disrespect.” I don’t remember writing it. It’s accurate.',
      'l-skill': 'Swimming properly. I can survive in water, but I swim like someone negotiating with it.',
      'l-food':
        'Puff-puff tastes like my grandmother’s veranda. She made too many on purpose so the neighbours’ children would come by.',
      'c-changed':
        'I thought I had to be the funny one in every room. Lately I’m learning I’m allowed to be the quiet one sometimes, and people still stay.',
      'c-taught':
        'My choir conductor, who once stopped rehearsal to tell a nervous boy, “Your voice is needed, not just allowed.” I’ve said it to people since.',
      'c-week':
        'Saturdays I teach my mum to use her smartphone. We are on week thirty. She now sends me memes I sent her two years ago.',
      'c-ease': 'When there’s music on and nobody is the centre. Weddings, choir, a kitchen with the radio going.',
      'p-forgive':
        'My father, for leaving when I was twelve. I’m not done. Some days I’m further along than others, and I’ve stopped pretending there’s a finish line.',
      'p-hope': 'To write a song that a choir somewhere sings long after I’m gone, without anyone knowing who wrote it.',
      'p-friend': 'Check on the strong friend. The one who is always fine. We are frequently not fine.',
      'p-hard':
        'Work has been heavy and I’ve been tired in a way sleep doesn’t fix. What helped: saying no to two things, and singing louder than necessary.',
      'l-place': "A grill spot under a flyover. Plastic chairs, terrible lighting, the best suya in the city. You’d have to trust me.",
      'l-sound': "The generator next door starting up when the power cuts. Everyone groans, and then everyone keeps talking.",
      'c-habit': "Kept: I still hum when I’m concentrating. Dropped: waiting for permission to speak in meetings.",
      'c-evening': "Face mask, a film so dramatic it’s basically comedy, and voice notes to my sister narrating the plot.",
      'p-unsure': "I believed I was bad at being alone. I’m actually fine alone. I was bad at being lonely, which is different.",
      'p-thanks': "My secondary school maths teacher, who called my mistakes “interesting.” I didn’t believe him, but I kept going.",
    },
  },
  {
    id: 'hiro',
    reserve: 1,
    city: 'Osaka',
    firstName: 'Hiro',
    work: 'Runs a small bicycle repair shop in Osaka',
    wroteAt: { 'd-noticed': '06:45', 'd-nine': '05:30', 'd-proud': '18:10', 'd-place': '22:50' },
    answers: {
      'd-noticed': 'The cherry tree outside my shop drops one petal into the oil tray every morning. Same tray. I have stopped moving it.',
      'd-nine': 'A train driver. I fix bicycles now. Still wheels.',
      'd-proud': 'I have never thrown away a part that could be repaired. My shop is crowded because of this.',
      'd-place':
        'The public bath in my neighbourhood at closing time, when the old men talk about baseball. I don’t follow baseball.',
      'l-morning':
        'Up at five. Rice, miso, radio news. Shutter up at seven. The first customer is usually a schoolgirl with a flat tyre.',
      'l-laugh': 'A customer’s parrot said “welcome” when I walked into his house. Better manners than most people.',
      'l-skill': 'Drawing. I can draw a gear perfectly. A face, no.',
      'l-food': 'Okonomiyaki tastes like my older brother. He cooked badly, but with confidence.',
      'c-changed': 'I thought quiet people were boring. Then I noticed I am a quiet person, and I am not boring to myself.',
      'c-taught':
        'My first boss. He fixed a child’s bicycle for free and charged a rich man double for the same repair. He said, “Balance.”',
      'c-week':
        'Tuesday nights I play shogi with a retired dentist. Nine years now. We know almost nothing about each other’s lives. It is perfect.',
      'c-ease': 'When there is work to do side by side. Two people fixing one thing don’t need to talk much.',
      'p-forgive':
        'Myself, for not visiting my mother more before she got sick. I go every Sunday now. It does not cancel the old Sundays.',
      'p-hope': 'That someone will take over the shop. And keep the old parts.',
      'p-friend': 'Notice when the other person is tired, and leave early.',
      'p-hard':
        'My knees are getting bad, and the shop is a lot of kneeling. What helps: a stool a customer built for me. He didn’t ask. He just brought it.',
      'l-place': "The river path at six in the morning. Nobody there but the herons and one man who runs backwards.",
      'l-sound': "The bell on the shop door. Thirty years. I would know it anywhere.",
      'c-habit': "Kept: I bow to my tools before I put them away. Dropped: eating fast.",
      'c-evening': "A bath, a can of beer, a baseball game on the radio that I don’t understand. I like the announcer’s voice.",
      'p-unsure': "I thought I didn’t need anyone. My wife died seven years ago. I was wrong.",
      'p-thanks': "The customer who built me the stool. I said thank you. It was not enough.",
    },
  },
  {
    id: 'lucia',
    city: 'Montevideo',
    firstName: 'Lucía',
    work: 'Teaches history at a secondary school in Montevideo',
    wroteAt: { 'd-noticed': '19:20', 'd-nine': '23:15', 'd-proud': '00:05', 'd-place': '18:40' },
    answers: {
      'd-noticed':
        'Every evening on the seafront a group of older women walk exactly the same route, and at one lamppost they all touch it. I asked one why. She said “tradition” and refused to elaborate. I’m obsessed.',
      'd-nine':
        'An archaeologist, after a documentary about Pompeii. Now I teach history to fifteen-year-olds, which is also excavation — mostly of their attention.',
      'd-proud':
        'A student who hated history applied to study it at university. She sent me a photo of her acceptance letter at midnight. I cried in my pyjamas.',
      'd-place':
        'The seafront at sunset with a thermos of mate. It’s a cliché in Montevideo, but clichés exist because they work.',
      'l-morning':
        'Mate, of course, and twenty minutes of reading something that isn’t for work before the house wakes up. Then chaos.',
      'l-laugh':
        'I was explaining the fall of Rome and a student asked, very seriously, whether the Romans knew they were “ancient”. I had to sit down.',
      'l-skill': 'Tango. There is tango everywhere here and I dance like a filing cabinet falling down the stairs.',
      'l-food':
        'Torta frita on rainy days tastes like my neighbour Elsa, who knocks on every door with a plate of them the moment it starts to rain.',
      'c-changed':
        'I used to think history was about big men and big dates. Now I think it’s mostly ordinary people trying to get through a Tuesday. It changed how I teach.',
      'c-taught':
        'My grandfather, a bus driver who knew the life story of every regular passenger. He taught me that everyone is a primary source.',
      'c-week':
        'Thursday evenings I volunteer at an adult reading class. Last month a man of seventy wrote his own name for the first time. The whole room applauded.',
      'c-ease': 'Around a long table with too much food and at least three conversations at once. Silence makes me nervous; noise makes me safe.',
      'p-forgive':
        'Myself at twenty-five, who said yes to everything and lost track of what she wanted. I’m kinder to her now. She was trying.',
      'p-hope':
        'To write a book of small histories — the women at the lamppost, Elsa, my grandfather’s passengers. People nobody writes down.',
      'p-friend': 'Ask the second question. Most people ask “how are you” and stop at “fine”. A good friend asks the follow-up.',
      'p-hard':
        'My father has been ill and I drive to the countryside every weekend. What helped: my students made him a card with forty signatures. It lives on his fridge.',
      'l-place': "The old market by the port on a Saturday. The grill smoke, the waiters who call everyone “my love,” the noise. My city in one room.",
      'l-sound': "The neighbour’s dog, who howls along with ambulance sirens. He sings, really. He’s in tune.",
      'c-habit': "Kept: I still read the last page of a book first. Don’t tell anyone. Dropped: saying sorry before I ask a question.",
      'c-evening': "Empanadas from the corner, a terrible historical drama, and shouting at the screen when they get the dates wrong.",
      'p-unsure': "I thought I needed certainty to function. Then the schools closed for a year, and I found out I can improvise like everyone else.",
      'p-thanks': "My first headteacher, who sat through my worst lesson ever and afterwards only said, “Again tomorrow. You’ll be better.”",
    },
  },
  {
    id: 'farid',
    city: 'Toronto',
    firstName: 'Farid',
    work: 'Former civil engineer, now studying pastry in Toronto',
    wroteAt: { 'd-noticed': '07:35', 'd-nine': '06:10', 'd-proud': '21:25', 'd-place': '23:30' },
    answers: {
      'd-noticed':
        'Everyone on my streetcar now holds the pole with their sleeve pulled over their hand. Nobody decided this. It just happened, like birds.',
      'd-nine':
        'A pilot. I became a civil engineer, and now, at forty-six, I’m studying pastry. Nine-year-old me is confused but supportive.',
      'd-proud':
        'My croissants finally have proper layers. Seventy-two attempts — I counted. My neighbours ate every failure without complaint.',
      'd-place':
        'My mother’s rooftop in Algiers, hanging laundry, the sea showing between the buildings. I haven’t been back in six years.',
      'l-morning':
        'Butter out of the fridge at six, folding practice, then coffee while the dough rests. The dough decides when I’m allowed to be lazy.',
      'l-laugh':
        'A classmate, twenty-two, called me “uncle” in front of the chef, then apologised so hard she called me “sir”. Both were worse.',
      'l-skill': 'Ice skating. Twelve years in Canada and I still skate like a folding chair.',
      'l-food': 'Makroud tastes like Eid at my aunt’s house — all of us cousins fighting over the ones with the most honey.',
      'c-changed': 'I thought it was too late to change careers. It wasn’t too late. It was just frightening, which is different.',
      'c-taught':
        'My father, who repaired neighbours’ radios in the evenings and never took money. He said, “They’ll bring bread one day.” They always did.',
      'c-week':
        'Every Sunday I call my mother and we cook the same recipe at the same time, eight thousand kilometres apart, and compare on video. Hers always wins.',
      'c-ease': 'In a kitchen. Anyone who has cooked with me knows things I’d never say in a living room.',
      'p-forgive':
        'Myself, for leaving home and not calling enough in the first years. I was busy surviving. I’m making up for it one Sunday at a time.',
      'p-hope':
        'A small bakery that smells like both Algiers and Toronto, where the old men from my street and the students would both feel at home.',
      'p-friend': 'Eat the failed croissants and say thank you. Support the attempt, not just the result.',
      'p-hard':
        'Money is tight while I study, and I’m older than my teachers. What helps: a friend who sends me a photo of every pastry she sees with “yours would be better.”',
      'l-place': "A Portuguese bakery on my street that opens at five. I’d tell you which tart to order, then pretend mine are better.",
      'l-sound': "The streetcar bell. In Algiers it was the sea and the call to prayer. Here it’s the bell. Both mean the day has started.",
      'c-habit': "Kept: I still smell bread before I buy it. Dropped: believing engineers don’t cry.",
      'c-evening': "I bake something I have no reason to bake and give it away the next day. An evening alone is an evening for experiments.",
      'p-unsure': "I thought I needed a respectable job title. It turns out I needed busy hands and flour on my sleeves.",
      'p-thanks': "A stranger at the airport when I arrived, who saw I was lost, walked me to the right bus and paid my fare. I never got her name.",
    },
  },
  {
    id: 'priya',
    city: 'Pune',
    firstName: 'Priya',
    work: 'Urban planner in Pune',
    wroteAt: { 'd-noticed': '09:05', 'd-nine': '23:45', 'd-proud': '08:20', 'd-place': '10:30' },
    answers: {
      'd-noticed':
        'The new footpath on my street has a tree in the middle of it, because they built around it instead of cutting it down. Everyone walks around it carefully, like it’s a person.',
      'd-nine':
        'A detective. I’m an urban planner now, which mostly means investigating why people refuse to use a perfectly good footbridge. Usually the bridge is wrong.',
      'd-proud':
        'I learned Marathi properly as an adult so I could talk to the vegetable sellers on my street in their own language. They correct my grammar every morning, with great pleasure.',
      'd-place':
        'The old city on a Sunday morning before the shops open, when the streets belong to dogs, cyclists and grandfathers buying milk.',
      'l-morning':
        'Filter coffee, a printed newspaper because I’m stubborn, and a walk around the block to see what changed overnight. Something always has.',
      'l-laugh': 'I tripped over the exact kerb I’ve been writing a report about. Field research.',
      'l-skill': 'Sketching people in cafés. I can draw a site plan, but my faces come out looking like maps of faces.',
      'l-food':
        'Poha tastes like my best friend’s mother, who fed me every morning before school for six years and never once asked if I was hungry. She just knew.',
      'c-changed':
        'I used to think good design meant getting everything right. Now I think it means leaving room for people to do things you didn’t predict.',
      'c-taught':
        'My grandmother, who rearranged her furniture every season “so the house doesn’t get bored.” I think about it in every project.',
      'c-week':
        'A surprising amount of it is sitting on benches with a notebook, counting how many people sit on other benches. It’s my job. It looks very suspicious.',
      'c-ease': 'When someone else has planned the evening and I’m allowed to stop thinking. Which is rare, and lovely.',
      'p-forgive':
        'Myself, for rehearsing conversations so thoroughly in my head that I sometimes forget to actually have them.',
      'p-hope':
        'That a park I designed becomes the place where some child learns to ride a bicycle, and they remember it forever without ever knowing my name.',
      'p-friend': 'Let you be boring with them. Not every meeting has to be an event.',
      'p-hard':
        'I’ve been lonely since moving back home — old friends have moved, or married, or both. What helped: saying yes to a neighbour’s invitation I almost declined.',
      'l-place': "A three-hundred-year-old stepwell hidden behind a car park. Most people in the city don’t know it exists. I go when I need quiet.",
      'l-sound': "Pressure cookers whistling from every kitchen in my building at eight in the evening. An orchestra nobody rehearsed.",
      'c-habit': "Kept: I make lists for everything, including lists of lists. Dropped: assuming the loudest person in the meeting is right.",
      'c-evening': "I walk until I’m lost on purpose, then take a rickshaw home and ask the driver what he’d change about the city.",
      'p-unsure': "That I was an extrovert. I’m just good at talking. It costs me more than people see.",
      'p-thanks': "My grandmother, again. She paid for my first year of university with money she’d hidden in a rice tin for thirty years.",
    },
  },
  {
    id: 'sigrun',
    reserve: 1,
    city: 'Reykjavík',
    firstName: 'Sigrún',
    work: 'Makes radio documentaries in Reykjavík',
    wroteAt: { 'd-noticed': '11:00', 'd-nine': '16:25', 'd-proud': '04:05', 'd-place': '15:50' },
    answers: {
      'd-noticed':
        'The light came back this week. Not much — four extra minutes. But everyone in the bakery queue was suddenly talking to each other.',
      'd-nine': 'A volcano scientist. I make radio documentaries now. I still mostly record rumbling things.',
      'd-proud':
        'I recorded a glacier calving at four in the morning in a storm, with frozen fingers. It’s twelve seconds long and nobody has ever asked to hear it.',
      'd-place':
        'A hot pool on the north coast in winter, snow falling into the water, strangers talking quietly in the steam. Nobody is anyone there.',
      'l-morning': 'Dark outside, a candle, coffee, the shipping forecast on the radio. I don’t own a boat. It calms me anyway.',
      'l-laugh':
        'My microphone caught my own stomach growling during a very serious interview with a bishop. He pretended not to hear. It’s on the tape forever.',
      'l-skill':
        'Knitting without looking. My aunts do it while talking, watching television and arguing. I knit like someone defusing a bomb.',
      'l-food':
        'Rye bread baked in the ground by a hot spring tastes like my uncle, who believed every problem could be solved with butter and patience.',
      'c-changed':
        'I thought I needed a lot of people around me to be happy. Now I think I need three, and a silence that doesn’t feel like absence.',
      'c-taught':
        'An old fisherman I interviewed who said, “The sea doesn’t care, which is restful.” I’ve thought about it every week for ten years.',
      'c-week':
        'Most of it is listening to tape — hours of people talking — to find the one sentence that is true. Like panning for gold, except the gold is a voice cracking.',
      'c-ease': 'Walking. Side by side, facing the same way, nobody has to look at anybody.',
      'p-forgive':
        'My father, for the winters he drank and the house went quiet. He stopped twenty years ago. I’m still letting the silence go.',
      'p-hope': 'To make one piece of radio so good that someone pulls their car over to keep listening.',
      'p-friend': 'Stay in touch through the boring years. Friendship isn’t only for the dramatic ones.',
      'p-hard':
        'Winter is long and this one has been heavy. What helped: a friend who calls every Wednesday at eight and doesn’t need me to have any news.',
      'l-place': "A lighthouse at the end of a gravel road, where the ravens wait for picnics. I’d take you there in the wind.",
      'l-sound': "The wind against my kitchen window. It has about twelve voices. I can tell what the weather will do.",
      'c-habit': "Kept: I still sleep with the curtains open. Dropped: filling every silence in an interview.",
      'c-evening': "A long bath, one candle, the radio off for once. I listen to the house settle.",
      'p-unsure': "That I was a cold person. I’m not. I was raised by people who didn’t say things, so I learned to say them on the radio instead.",
      'p-thanks': "My first editor, who cut my favourite thirty seconds of tape — and was right. She taught me that love sometimes means cutting.",
    },
  },
];

const BY_ID = new Map(PEOPLE.map((p) => [p.id, p]));

export function personById(id: string): Persona {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`Unknown person ${id}`);
  return p;
}
