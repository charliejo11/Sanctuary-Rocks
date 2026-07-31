import { normalizeForMatch } from "./crewTypes";

// Bio-only lookup for the Meet the Crew page's click-to-expand modal. This
// is deliberately NOT the source of truth for who's on the crew, their
// photo, or their on-card role - that's still the folder scan in
// app/lib/crewImages.ts (loadRoster), exactly as before, so dropping a new
// photo into public/images/djs or public/images/hosts still "just works"
// with no code change. This file only supplies bio text, looked up by
// name, and only for the modal.
//
// HOW TO ADD/EDIT A BIO: find the person below and paste their biography
// into the `bio` field (as a plain string). Leave it as "" to keep showing
// "Bio coming soon." on their card. Use a blank line (two newlines in a
// row) between paragraphs - the modal renders each one as its own <p>.
// Do not invent bios here - only real, provided text belongs in this file.
//
// Bios used to be hand-made image graphics (public/images/Bios/*); those
// have been transcribed into the `bio` field below so every biography now
// renders as real, readable, selectable HTML text instead of a screenshot.
// The source images are left in place on disk but are no longer referenced
// by any code.

export type CrewBioEntry = {
  id: string;
  name: string;
  role: "DJ" | "Host";
  image: string;
  bio: string;
};

export const CREW_BIOS: CrewBioEntry[] = [
  // ---- DJs (public/images/djs) ----
  {
    id: "dj-berry",
    name: "Berry",
    role: "DJ",
    image: "/images/djs/Berry.png.jpg",
    bio: "Well hello there, I see you stopped in to read this. So I guess I should add something about myself. I'm Berry, that random pink one that DJs and talks like I don't have a normal brain cell left. Yeah that's me.\n\nI have been into music since I was a kid. Grew up playing a lot of instruments and studying music. I feel that music is the key when no other words or emotions can be spoken.\n\nI guess I would say I am a person of weird taste. I am an Air Force vet of 22 years. My babies are my A-10 Warthog and my farm animals - you'll hear me talk about them from time to time. My mouth sometimes seems to have a mind of its own and things just happen to slip out, but that's what makes it fun trying to figure out what I am going to say next.\n\nIn SL I do a lot of DFS farming, DJ, and bug my friends on a daily. I started at SR when SR wasn't SR but when it was SOR, and thank you to the now owner Moose, Chellz, and Jayme for making the club better than it has ever been. I am glad I came back and seen how it really grown. I love you all, thank you for letting me be myself while I am on that stage.",
  },
  {
    id: "dj-angelo",
    name: "DJ Angelo",
    role: "DJ",
    image: "/images/djs/DJ%20Angelo.png.jpg",
    bio: "- I was born at a very young age!\n- USAF retired\n- BA degree in Broadcast Production\n- Former RL radio and skating rink DJ\n- Enjoy all types of music, save for country.\n- Favorite HR/Metal genres =\n--- 80's and 90's Hard Rock\n--- 80's Hair/Glam Metal\n--- Symphonic Metal\n--- Nu Metal\n--- Power Metal\n--- Pirate Metal\n--- Traditional Heavy Metal\n--- A mix of tunes from across all sub-genres\n\n- Love taking requests and discovering new to me music/bands!\n\n- DJ at Sanctuary Rocks since July, 2024! See my profile for current set times/days!",
  },
  {
    id: "dj-bratty",
    name: "DJ Bratty",
    role: "DJ",
    image: "/images/djs/DJ%20Bratty.png.jpg",
    bio: "Hiya! I'm DJ BrattyBunny 🐰🎧\n\nI'm 37 years young and the DJ Manager at Sanctuary Rocks! Music is my absolute favorite thing in the world, and I love bringing people together through great tunes and good vibes.\n\nOutside of music, I love hanging out with my amazing friends, being a little wild, laughing way too much, and making memories. I'm kind, sweet, a little sassy, and definitely have a bratty side—but all in good fun! 💖\n\nCome say hi, request a song, or just hang out. Let's make some awesome memories and keep the music going! 🎶💕",
  },
  {
    id: "dj-calamity",
    name: "DJ Calamity",
    role: "DJ",
    image: "/images/djs/DJ%20Calamity.png.jpg",
    bio: "Hello there everyone! Just who am I exactly? A Québécois (French Canadian), a gentleman, a musician. Sax player in RL, music has always been a part of me. From classical to metal, it's the same difference. I'm also an engineer so I tend to be a perfectionist... a tiny bit. I'm a sponge to knowledge, I love to learn anything on everything and discover the world that's around us. Funny, weird, a bit ADD, a bit OCD - that's me too. When I'm not spinning those metal songs, you might find me scripting here and there the stuff that my wife builds on SL, or playing some engineering games, always while discovering new songs to share. You see, music is not what I do, it's what I am.",
  },
  {
    id: "dj-charliejo",
    name: "DJ CharlieJo",
    role: "DJ",
    image: "/images/djs/DJ%20CharlieJo.png",
    bio: "",
  },
  {
    id: "dj-chellz",
    name: "DJ Chellz",
    role: "DJ",
    image: "/images/djs/DJ%20Chellz_.png.jpg",
    bio: "Music is my passion, and the DJ booth is where I feel most at home. I'm outgoing, love meeting new people, and enjoy creating unforgettable experiences through great music and good vibes.\n\nAs the co-owner and manager of one of the top rock and metal clubs in Second Life, I'm dedicated to building an amazing community where music lovers can connect, rock out, and have a great time. Whether I'm spinning heavy riffs, organizing events, or welcoming new faces, I'm all about keeping the energy high and the atmosphere fun.\n\nIf you love rock, metal, and great company, you'll probably find me behind the decks or helping keep the party going.",
  },
  {
    id: "dj-corbyn",
    name: "DJ Corbyn",
    role: "DJ",
    image: "/images/djs/DJ%20Corbyn.png.jpg",
    bio: "DJ Corbyn Weymann brings the ultimate Rock and Metal experience straight to the heart of Second Life. For Corbyn, it's always about the music first—everything else is just a bonus. Driven by a pure passion for heavy riffs and anthemic beats, his mission is to make sure every single person at his gig feels the energy radiating from the decks.\n\nAs a proud resident DJ at Sanctuary Rocks, Corbyn is honored to spin for the undisputed best Rock and Metal venue in SL. Off the stage, this cheeky Brit brings quick-witted banter and a massive personality to the crowd. He loves connecting with music lovers from every corner of the globe. Come for the metal, stay for the laughs!",
  },
  {
    id: "dj-eros",
    name: "DJ Eros",
    role: "DJ",
    image: "/images/djs/DJ%20Eros.png.jpg",
    bio: "My name is Jamesdarkside Resident, or DJ EROS for my DJ tag. I love metal and rock music the best. I love action, comedy, and horror genre movies. I work at Sanctuary Rocks, one of the best - well, it is the best - rock and metal clubs in SL. I'm from Kentucky and lived here all my life. Anything else you need to know, well just ask :)",
  },
  {
    id: "dj-hollywood",
    name: "DJ Hollywood",
    role: "DJ",
    image: "/images/djs/DJ%20Hollywood.png.jpg",
    bio: "Hailing from the Great White North, and a long standing fixture at Sanctuary Rocks. When I'm not wrangling rogue Moose or winning bar fights against Canadian geese, I'm creating a sonic assault of modern metalcore and throwbacks that will make you feel every single year of your age. Come for the riffs, stay for the existential crisis.",
  },
  {
    id: "dj-iggy",
    name: "DJ Iggy",
    role: "DJ",
    image: "/images/djs/DJ%20Iggy_.png.jpg",
    bio: "Well hello!! I am a Canadian, smart mouthed, sassy at times, and a complete brat in nature. Fast and hard is the way I like to play - something that will give you a heartbeat and make you all sweaty inside n outside. When I'm not here in my element, I am usually being nosey somewhere - exploring the unknown is a good way to say it. I enjoy spontaneous things and I love to chatter to people about anything that pops in my head, no matter where it goes - fun, eventful, and crazyness. I'm fun, crazy, and I love to laugh and make people laugh. Music is my drug!!\n\nMy best saying: \"I'd rather regret the risks that didn't work out than the chances I didn't take at all.\"\n\n— Iggy",
  },
  {
    id: "dj-jayme",
    name: "DJ Jayme",
    role: "DJ",
    image: "/images/djs/DJ%20Jayme.png.png",
    bio: "Coo @ Sanctuary Rocks Club & Sim\n\nI have been in SL for almost 19 years. I started off as a dancer way back in 2007. Then moved to hosting and DJ'ing. Now one of the co-owners of one of the best Rock/metal clubs in all of SL.\n\nMusic is a HUGE part of who I am. 80's music is my weakness, I have no shame in my game.. If there is no music I would DIE! LOL. I am the AFK Queen, because I'm usually either making dinner, running around, or doing work behind the scenes for the club. I give absolutely zero what anyone thinks of me, I will always tell the truth even if it hurts your feelings. I am sarcastic, mouthy, & blunt. Oh & I swear ALOT!",
  },
  {
    id: "dj-amira",
    name: "Amira",
    role: "DJ",
    image: "/images/djs/Amira.png.jpg",
    bio: "Amira Farshore—also known as DJ Amira, The Vixen—is a proud member of the Sanctuary Rocks family. She is also the owner of Roja's and Hellforged and co-owner of Blackwood Systems™. With a passion for powerful music, unforgettable energy, and bringing people together, she creates a place where everyone can escape, have fun, and enjoy the moment.\n\nFierce, loyal, playful, and always unapologetically herself, Amira believes music should be felt—not merely heard. Whether she is rocking the stream, supporting her friends, or getting the crowd moving, The Vixen brings her heart, fire, and attitude to everything she does.\n\nTurn it up, let go, and come rock the Sanctuary with DJ Amira—The Vixen!",
  },
  {
    id: "dj-caro",
    name: "DJ Caro",
    role: "DJ",
    image: "/images/djs/DJ%20Caro.png.jpg",
    bio: "Hi! I'm Carolina, known as DJ Caro at Sanctuary Rocks. I joined the team a few years ago and I really enjoy sharing metal and hard rock with all the listeners. I like to explore all the subgenres and showcase new bands to help them reach a wider audience. When I'm not here, I produce metal radio shows and I'm in constant contact with musicians and record labels in the metal genre.",
  },
  {
    id: "dj-gothy",
    name: "DJ Gothy",
    role: "DJ",
    image: "/images/djs/DJ%20Gothy.png.jpg",
    bio: "Hey there! I'm DJ Gothy or as I say... DJ GothMan, I've been a DJ for nearly 20 years and have a massive love for rock and metal, my guilty pleasure is rock covers of today's and yesteryears hits. My nose is most likely buried in the many seas of YouTube, Spotify and any platform that holds a grand slam of music of all sorts. I'm usually very friendly and outgoing with just about any topic of conversation and love to laugh and have fun! My persona is slapstick and the humor in all things serious and sometimes controversial. Above all that, I'm a man with a massive heart who cares a lot about people and giving the crowd what they like. I'm always up for intelligent and respectful conversations, hit me up anytime! (I also have a love for the dark, creepy, and interesting things.. wanna know more, feel free to ask!) I'm an open book with a vast mind for anything.",
  },
  {
    id: "dj-junglist",
    name: "DJ Junglist",
    role: "DJ",
    image: "/images/djs/DJ%20Junglist.png.png",
    bio: "Been DJing for about 22 - 25 years, even before SL. Took a few years break because got burned out, but im back baby!!\n\nI'm about the tunes and making people laugh even at my own risk. I feel if you can make people laugh and help them listen to tunes that move them, you can help them forget about the BS of the normal day just for a bit, and that bit is everything for them.\n\nLove all types of music but SR actually made me want to start DJing again so I love this club and will fight for it anytime they need me to.\n\nJunglist Diesel",
  },
  {
    id: "dj-logan",
    name: "Logan",
    role: "DJ",
    image: "/images/djs/Logan.png.jpg",
    bio: "I've been DJing for over 10 years now, and I still enjoy every minute of it. I'm a born-and-raised Texan and have called Texas home my entire life.\n\nBefore I ever stepped behind the virtual decks, I was a musician. I was fortunate enough to meet and spend time with many incredible artists in the Metal scene before life took me in one of the most unexpected directions imaginable—I became a firefighter. I've been doing that for more years than I care to admit, and they say the fire gets in your blood. They're absolutely right.\n\nI'm a true music junkie who enjoys just about every genre, but Metal was one of the first styles of music I discovered on my own, and it remains a huge part of who I am.\n\nWhen I'm not spinning tunes or saying something completely ridiculous on the mic, you'll usually find me creating new pieces for my shop, Mythworks LTD, or working on my novel, which I hope to release in the not-too-distant future. If I could just convince my brain that editing is as much fun as writing, I'd probably be finished by now.\n\nOh, and I have ADHD and proudly advocate for the neurodivergent community. If that means I occasionally go off on a tangent... well, now you know why.\n\nSee you at Sanctuary!",
  },
  {
    id: "dj-kaya",
    name: "DJ Kaya",
    role: "DJ",
    image: "/images/djs/DJ%20Kaya.png.jpg",
    bio: "Sanctuary Rocks SR DJ - Kaya.Osbourne\n\nHello! I'm DJ Kaya, a Brazilian music lover - specially metal and rock, and I'm DJ in Second Life since 2012. Music has always been my favorite way to express myself and connect people through great experiences. Between sets, I enjoy discovering new sounds, living out great stories, and savoring life's little moments. I'm friendly, dedicated, and naturally shy, but I believe a smile, a good conversation, and the right music can transform any atmosphere. To me, every performance is an opportunity to create unforgettable memories and share the incredible energy that music conveys.",
  },
  {
    id: "dj-krankee",
    name: "DJ Krankee",
    role: "DJ",
    image: "/images/djs/DJ%20Krankee.png.jpg",
    bio: "Greetings,\n\nI've DJ'd over 10 years in SL. I've enjoyed playing different genres for different venues but always come back to rock, metal, classic rock, etc, but branch out from there.\n\nI enjoy seeing what others in SL have to offer, request-wise, whether VIPs or DJs, I haven't heard before. I've heard a lot in SL that I haven't come across RL music-wise, and it's been a fun journey. Let's continue the music exploration together!!",
  },
  {
    id: "dj-lucky",
    name: "DJ Lucky",
    role: "DJ",
    image: "/images/djs/DJ%20Lucky_.png.jpg",
    bio: "Hello I am DJ Lucky!! My mission is simple: play it fast, play it loud, and live life at absolute max volume. Equal parts basshead and absolute nerd. When I'm not sharing my love for music, I'm getting lost in anime, diving into comics, or leveling up in video games. Life's too short for slow tempos—let's rage.",
  },
  {
    id: "dj-magas",
    name: "DJ Magas",
    role: "DJ",
    image: "/images/djs/DJ%20Magas.png.jpg",
    bio: "Since 2011 I've been in and out of Second Life.\n\nI've been on the one I call home now for the past 7 years.\n\nI've worked various DJ jobs. But the one place that I could always call home was Sanctuary Rocks.\n\nI began my journey with Sanctuary in 2020. My first stay lasted a few months. I came back in 2023 and have been with the club ever since. It's been one hell of a journey, and I can't wait to see where it goes from there.",
  },
  {
    id: "dj-sound",
    name: "DJ Sound",
    role: "DJ",
    image: "/images/djs/DJ%20Sound.png.png",
    bio: "I am Soundtrack Nirvana, I've been on SL for technically 18 years, but on Sound for 16 years. I work hard on him and am obsessed with shopping. I've been a DJ for what seems like forever, and listening to so many genres, but I stand by my Rock and Metal roots. I enjoy film and TV and anything pop culture related. I'm good with names, and when the time is right, it's nice to meet someone who gets you. I enjoy animals more than I do people. It's amazing to get to see animals from all over the world, so I enjoy that. While I don't currently own a cat or dog, I've enjoyed having cats my whole life. My favorite colors are Red and Black. History is definitely my thing academically. I like writing many things - stories, lyrics, poems. I live in the East. I'm used to the long and cold winters and the humid and hot summers. Smartass by choice. That's me.",
  },
  {
    id: "dj-trelk",
    name: "DJ Trelk",
    role: "DJ",
    image: "/images/djs/DJ%20Trelk.png.png",
    bio: "Trelk Moonwall\n\nI'm someone who loves all kinds of music—from country and classic rock to post-hardcore and metal. Music is a big part of my life, and I'm always up for discovering something new. I enjoy great conversations, laughing, and having a good time with people. At the same time, I also have a quieter side and appreciate relaxing nights in, especially if they involve gaming. I value authenticity, humor, and enjoying the moment.",
  },
  {
    id: "dj-vandon",
    name: "DJ Vandon",
    role: "DJ",
    image: "/images/djs/DJ%20Vandon.png.png",
    bio: "Hi I'm Vandon. I'm a U.S. Army Veteran and a Sous Chef, who just happened to go to school for radio broadcasting before they decided he should be retired at 25. I've been DJing now for 15 years and loving every moment of the club scene on SL and RL. My hobbies are repairing electronics, cars and appliances, anime, and tormenting management with suspiciously amusing rumors.",
  },
  {
    id: "dj-dann",
    name: "Dann",
    role: "DJ",
    image: "/images/djs/Dann.png.jpg",
    bio: "Hi,\n\nMy name is Daan Shuffle, living in the Netherlands (north-west Europe).\n\nI love music. A wide range of music that I like, but my heart lies with rock (even the classic) and metal. I love music in general, so I also like all other kinds of music.\n\nI am retired from the navy after almost 40 years of service.\n\nAt a local radio station I am a DJ and present a news show with local news, interviews, etc.\n\nStarted with bonsai last year, which is not really easy to keep them alive, but I followed a course so we'll see if I learned something.\n\nHopefully this will do for now, if not, let me know.\n\nGrtz Daan",
  },
  {
    // Moved here from the Hosts section - her photo file was relocated
    // from public/images/hosts/ to public/images/djs/, so the folder-scan
    // roster now lists her as a DJ. Bio text is unchanged.
    id: "dj-domi",
    name: "Domi",
    role: "DJ",
    image: "/images/djs/Domi.png.jpg",
    bio: "I've been spinning in Second Life about 6 years. I went from being obsessed with spinning and grabbing any set I could, to eventually dropping down to 3 times a week. Rock and metal are my jam, though I've been known to spin a bit of country from time to time.\n\nMy real life is fairly busy with my two businesses. Ranching is where my heart is. I'm single in real life and have no kids. In Second Life I've been partnered to Ozzy Giordano for 2.5 years, but we have been together for nearly 4 years.\n\nLife is good in both worlds!\n\nLove and light,\nDomi",
  },
  {
    id: "dj-manchester",
    name: "Manchester",
    role: "DJ",
    image: "/images/djs/Manchester.png.png",
    bio: "Welcome to my bio =]\n\nI have thought for a few days as to what to include in this, as most about me is already in my SL profile.\n\nThe idea behind our staff making these is so our VIPs can get to know a little more about us and what makes us all tick, and a bit of fun.\n\nBeing a DJ in SL is probably the main reason why I still continue to use SL. It has brought me lots of great friends along the way, some I have sadly lost =// That pains me a lot.\n\nI really enjoy being a DJ as it means that I can really express myself. I get a real buzz from finding new artists and music to bring to you all, and I spend hours and hours of my free RL time doing that. A set is 2 hours, but it can take much more of a DJ's time putting it together. Sure, I could load the same old tunes, like they do at other clubs, and pretend that I have done a good job, but that is not my style.\n\nA successful set for me, apart from the music, is interacting in local chat and watching you all having a riot, sometimes at my expense, but that's ok =] Working alongside our hard working hosts really helps as it allows me to \"get on with it\" as they take the strain. I tend not to make a fixed play list as I spin mostly from getting inspired by what is going on around me in the club. Without our VIPs we wouldn't even have a club that we can all be proud of. Seeing so many regular faces along with new ones is a real credit to everyone involved with the club.\n\nHere are a few of my likes and dislikes, both in SL and RL.\n\nI enjoy the company of positive people that have a sense of humour that don't hide behind a mask. If we can't laugh, what is the point?\n\nI'm not everyone's cup of tea and I know that, but I am the real me in SL and I am in RL, apart from being a Vampire of course ^^\n\nI dislike many things in both worlds so here are a few,\n\nSweaty people. Breath that smells like someone has eaten a 150g packet of pickled onion monster munch all to themselves. Negative people really get on my nerves. Backstabbers and fakes, and someone that spins lies. Being stuck in a queue behind someone at the checkout with a basket full of gruesome looking things.\n\nAnd really could go on and on but I won't.\n\nThanks for taking the time to read this and I will see you at the next set.\n\nManchester Hawker",
  },
  {
    id: "dj-moose",
    name: "Moose",
    role: "DJ",
    image: "/images/djs/Moose.png.jpg",
    bio: "Hello, I am Moose Houston, I am the founder of Sanctuary Rocks club. I am coming up on 26 years of being a DJ. Music is universal, it bridges all languages. I love all types of music and genres. I love to share new releases and bands with everyone I DJ for. I've recently been practicing my singing skills. I've spent my life singing along to all of my favorite bands, I felt it was time - never too old or late to learn to sing.",
  },
  {
    id: "dj-nashty",
    name: "Nashty",
    role: "DJ",
    image: "/images/djs/Nashty.png.jpg",
    bio: "Something about Nashty Von Rocker\n\nI've been in SL 13 years. And 13 is my lucky number.\n\nStarted out as a male stripper, where I got the nickname Nasty Nashy which morphed into Nashty, and it stuck.\n\nI then was a host for a while, but switched to DJing about 3 years ago.\n\nAlso a musician in RL. Play drums and keyboards. Write music. Started writing AI music, which led to me joining the Artificial Intelligence Band on SL.\n\nI have a dark, warped sense of humor, anyone that knows me will attest to that.",
  },
  {
    id: "dj-payne",
    name: "Payne",
    role: "DJ",
    image: "/images/djs/Payne.png.jpg",
    bio: "Hey hai hellooosss!! A bit about me... I'm just a homegrown Cajun girl with a smart, foul mouth and a deep love for my family. I have a profound love for music that has led me to the DJ side of the stage after hosting for years. I have a deep passion for video games, football, and wrestling. I have 3 fur babies that are my whole world. Mostly, just trying to navigate the best I can through this roller coaster we call life without the need for bail money, hahaha.",
  },
  {
    id: "dj-peacy-graves",
    name: "Peacy.Graves",
    role: "DJ",
    image: "/images/djs/Peacy.Graves.png.jpg",
    bio: "Hi there!\n\nI'm a woman from Germany and a DJ with a soft spot for bass ^^ My passion is metal and rock. I love animals and own five Maine Coon cats; they love music too and curl up around me, purring, while I play my sets. I have a great sense of humor and a strong sense of justice, and I love working in a team with people from diverse backgrounds. Many people love my \"quirky\" accent and my rolling \"r\"s—haha.\n\nI'm proud to be part of Sanctuary Rocks.",
  },
  {
    id: "dj-wylls",
    name: "Wylls",
    role: "DJ",
    image: "/images/djs/Wylls.png.jpg",
    bio: "Hey there! I'm a Southern brat with a passion for DJing and a deep love for rock and metal music that fuels my soul. When I'm not spinning tracks that get the crowd moving, you can find me lost in the pages of a good book or diving into the immersive worlds of my favorite video games, indulging my imagination while simultaneously rolling my eyes at the absurdities of life. My heart belongs to animals, and I'm the proud caretaker of a few furry companions who bring endless joy and mischief into my world. With a sprinkle of sarcasm in every conversation, I find humor in the everyday, blending my interests into a unique tapestry of creativity and fun.",
  },
  {
    // Bio graphic text refers to this DJ as "Panda" throughout and never
    // says "Alaster" - kept verbatim (not corrected/renamed) since it's
    // their own written words. Matched to the "Alaster" photo/bio filenames
    // because that's the only 1:1 pairing available; flagged to the user
    // as a name discrepancy worth confirming rather than silently assumed.
    id: "dj-alaster",
    name: "Alaster",
    role: "DJ",
    image: "/images/djs/Alaster.png.png",
    bio: "Panda is one of the epic DJs at Sanctuary Rocks, bringing incredible music, energy, and entertainment to the stage. Whether he's spinning crowd favourites or keeping the dance floor buzzing, Panda knows how to create an unforgettable atmosphere. When he's not behind the decks, Panda is one of the Club Managers, always approachable, supportive, and happy to help guests, VIPs, and staff whenever they need assistance. If I'm not at the club I'm working on a custom bike (look at my picks) or hanging with my MC or family.",
  },
  {
    // Was filed under Hosts (host-molokai) with an outdated bio and photo -
    // moved here since Molokai has DJ'd (not hosted) since 2016 per their
    // own updated bio below, and their photo now lives in public/images/djs.
    id: "dj-molokai",
    name: "Molokai",
    role: "DJ",
    image: "/images/djs/Molokai.jpg",
    bio: "I have always worked in my 15 years in SL, beginning when I was 3 months old as a stripper until Hurricane Sandy shut that club down. I was a host until 2016 when I became a country dj. Didn't like country much but lasted in that genre for 2 years. Hopped from rock club to rock club with some of them closing because of new owners. I rather like classic rock and the guitar rifts found in tunes like \"Smoke on the Water\" and \"California Hotel\". My musical tastes center around Hawaiian music, Jawaiian and jangalang styles. Given how obscure that is for the rest of the world, I just DJ without the love for hard rock and metal. My fans know I like cover requests the most.",
  },
  {
    id: "dj-raevyn",
    name: "Raevyn",
    role: "DJ",
    image: "/images/djs/Raevyn.png.png",
    bio: "Hi, I'm Raevyn. I have been in Secondlife for 14 years, and have been dj'ing for 13 of those years. I have dj'd at various places throughout the years, helped managed a couple of clubs and even owned a couple of my own.\n\nI've always been a rock/metal dj but I do play various genres. I have been at Sanctuary Rocks for a few months now. The atmosphere is always fun & I highly enjoy dj'ing here. I love the people I work with, I love the atmosphere, but most of all I love the music!",
  },
  {
    id: "dj-rox",
    name: "Rox",
    role: "DJ",
    image: "/images/djs/Rox.png.png",
    bio: "Hello! I am the weird, sorta crazy...redneck DJ here. \"Can you feel my heart?\" Yes, that fire of hard rock to heavy metal that taps deep within me. When I am not spinning the tunes for the rocking crowd, I am lost in crime shows, video games, horror and more horror, and yes my dog Charlie. Other then being a funny smart butt, I like the know who rule the world...this girl well my own little excited part.",
  },
  {
    id: "dj-sativa",
    name: "Sativa",
    role: "DJ",
    image: "/images/djs/Sativa.png.png",
    bio: "I'm a quirky old soul with a spirited personality, a passion for DJing, and a deep sassy voice made for memorable announcements. I love making people laugh, catching them off guard, and creating those special moments that make everyone stop and do a double take. I feed off the energy in the room, so can devour your mood and spit it out with music.\n\nWhen I'm not behind the DJ booth, I'm usually shopping for, planning, and choreographing shows in Second Life. I enjoy stepping outside the box, colouring beyond the lines, and creating experiences that are anything but ordinary. With me, there is rarely a dull moment.\n\nAlthough I may be quiet at times, I'm always paying attention. I'm proudly old-school, adaptable, and always willing to learn something new—because, as they say, resistance is futile.\n\nIn real life, I work from home around the clock and manage what can only be described as a small zoo filled with dogs, cats, and rats. I'm a huge animal lover, a lifelong insomniac, and someone with a colourful vocabulary that makes a sailor sound like a care bear.",
  },
  {
    id: "dj-shann",
    name: "Shann",
    role: "DJ",
    image: "/images/djs/Shann.png.png",
    bio: "As a retired United States Coast Guard Rescue Swimmer, dedication, teamwork, and serving others have always been at the heart of who I am. That same passion now lives on through music.\n\nWhen I'm behind the decks, my goal is simple—to bring people together through the power of music. Whether I'm playing for newcomers discovering Sanctuary Rocks for the first time or entertaining our amazing VIPs, I strive to create an atmosphere where everyone feels welcome, included, and connected.\n\nMusic has always been more than just sound to me; it's a universal language that unites people from all walks of life. Every set I play is about building energy, creating memories, and keeping the good vibes flowing. I believe rhythm has the power to bring souls together as one, regardless of where we come from.",
  },
  {
    // Bio image (public/images/Bios/DJ Tweek Bio.png.png) is cropped and
    // starts mid-sentence - no earlier text exists anywhere on disk. Added
    // verbatim at the user's request rather than inventing an opening; the
    // missing beginning can be pasted in later if it turns up.
    id: "dj-tweek",
    name: "DJ Tweek",
    role: "DJ",
    image: "/images/djs/DJ%20Tweek.png.jpg",
    bio: "the recognition; I do it for the love of the music and the feeling it creates when the right song hits at the right moment.\n\nI love bringing people together through music, whether that's filling a dance floor, sparking a singalong, or introducing someone to a track they didn't know they needed. My sets are built around rock and metal at heart, but if it fits the vibe and keeps the energy flowing, you'll hear it. Every crowd is different, and that's what makes every set its own experience.\n\nIf you've spent any time around me, you'll know I don't take life too seriously. I'm cheeky, I love a laugh, and I'm always up for a bit of banter. Life's too short not to have fun, and I try to bring that same energy every time I jump behind the decks.\n\nFor me, DJing has never been about pressing play—it's about creating memories, sharing the music I love, and giving people a few hours where nothing else matters except good tunes and good company.\n\nSo if you're looking for good vibes, loud music, and someone who's just as happy singing along with the crowd as he is behind the decks, you've found the right DJ. Come say hi, throw me a request, and let's make it a night to remember.",
  },

  // ---- Hosts (public/images/hosts) ----
  {
    id: "host-betsy",
    name: "Betsy",
    role: "Host",
    image: "/images/hosts/Betsy.png.jpg",
    bio: "I'm a fun loving party girl who lives for heavy metal, late-night gaming, and questionable party decisions. I love loud music, bold fashion, creative art, and gettin' stoned outta my gourd. When I'm online you'll usually find me laughing with friends, chasing good vibes, and proving I can rock huge boots and a curious mind at the same time. 🤘",
  },
  {
    id: "host-dante",
    name: "Dante",
    role: "Host",
    image: "/images/hosts/Dante.png",
    bio: "Hey there! I'm Dante, hosting here at Sanctuary Rocks for a couple years now, from all the way down South America! You can always find me on Sanctuary during sets, rocking and partying along with everyone to some great music while somehow not spilling a single drop off my whiskey. When I'm not around the stage, you can either find me exploring around the grid or, for the most part, gaming outside of SL.",
  },
  {
    id: "host-ginny",
    name: "Ginny",
    role: "Host",
    image: "/images/hosts/Ginny.png.jpg",
    bio: "Hyas, I only came to rock and metal in 2008 when I first came to Sanctuary and found I really liked it, lovin' Industrial too. My dislikes, well I have some - loll, don't like what I call growlers so much. When not hosting, love to play skill games or watching TV murders mostly, so I now know how to kill and get away with it lmao.",
  },
  {
    id: "host-irish-beauty",
    name: "Irish Beauty",
    role: "Host",
    image: "/images/hosts/Irish_Beauty.png.png",
    bio: "🍀 I'm your Fiery Red Headed Hostess with the Mostess, the Celtic Lass with a ton of Sass!!! I am also a Feisty Brat as some would say, but I am always here for you whenever you need me. I love to have fun and make people laugh, especially the DJ's when they are on VO. I love working at Sanctuary Rocks! It has been my home and family for years. No place I would rather host for. 🍀\n\nRock on Bitches!!!! 🤘🤘🤘",
  },
  {
    id: "host-justi",
    name: "Justi",
    role: "Host",
    image: "/images/hosts/Justi.png.png",
    bio: "Hi I'm Justi, I'm Polish-Canadian, lived in Canada for the past 36 years but recently moved back to my homeland Poland. I have been a host for the past 17 years on and off. You can find me at Sanctuary most of the time gibb-smacking people for being silly, but don't worry, I do it for love, and also love the drink Pepsi. When I'm not on SL I'm usually playing FB games or reading a good mystery and spy book. Music is my passion, love rock and metal. If you see me around, don't be afraid to say hi to me.",
  },
  {
    id: "host-legs",
    name: "Legs",
    role: "Host",
    image: "/images/hosts/Legs.png.png",
    bio: "Born in Cali but raised in Kansas, I have my prissy side but mostly my sassy ass country side. I'm a loyal and dedicated friend, always willing to listen with a friendly ear. Lover of dragons and butterflies and exotic cats.. I'm creative in both worlds, love to work with my hands. My furbaby is my ride or die and best friend.. Legz has a \"I don't give a shit\" attitude and will snap your britches when needed. I will laugh at your goofy jokes as I love to laugh. I was a nurse's aide for 30 yrs, so yes, I have a caring heart and I love to cook.",
  },
  {
    id: "host-mistine",
    name: "Mistine",
    role: "Host",
    image: "/images/hosts/Mistine.png.jpg",
    bio: "I like my video games tactical, my books terrifying, and my coffee strong. A fun-loving country girl at heart, I am a caring, fiercely loyal friend who consciously keeps my circle small. When I'm not rescuing or doting on critters big and small, my world revolves around exploring vast RPG worlds, dominating shooter lobbies, and reading horror until sunrise—matched only by the high-energy joy of hosting crowds at my favorite rock/metal club. I also have a serious weakness for bargain hunting and freebie shopping; luckily, great deals and pizza keep me alive!",
  },
  {
    id: "host-nawti",
    name: "Nawti",
    role: "Host",
    image: "/images/hosts/Nawti.png.jpg",
    bio: "My name is Nawti and I have been a Manager and Hostie on and off for Sanctuary since Day One, the very beginning, and it's always been the only place I call Home!\n\nI love hanging out with the people I call family and friends, playing video and board games, chilling out and having lots of laughs.\n\nI love animals and have 2 fur babies who I love with my whole heart.\n\nBeing sensitive is my super power and I always wear my heart on my sleeve.\n\nI am very loyal to both people and places I love, and I will always fight to the end for both.\n\nHope to see you all at the club soon!!",
  },
  {
    id: "host-nikcara",
    name: "Nikcara",
    role: "Host",
    image: "/images/hosts/Nikcara.png.jpg",
    bio: "I enjoy hosting for meeting amazing people and to help run my sandbox for people who have nowhere in SL to call a home - a place where they can change and build and script and design, and a place where people can chill and relax. That's why I host, mainly. I also love the do-sim design and terrain work. I also love animals and have three daughters who have all left home now, starting on their paths in life. I also love to draw and garden, read books, cook.",
  },
  {
    id: "host-rebekka",
    name: "Rebekka",
    role: "Host",
    image: "/images/hosts/Rebekka.png.png",
    bio: "Hello, I'm from Germany, since quite a few years now. I grew up with punk and then broadened my horizon with rock, metal and blues. I love to ride my bicycle, since I don't own a car. For many years I used to work as a teacher/trainer, so working with people is not new to me. Also I love to read books (real books, not ebooks), preferably old fashioned crime stories.",
  },
  {
    id: "host-rita",
    name: "Rita",
    role: "Host",
    image: "/images/hosts/Rita.png",
    bio: "Hey rockstars! I'm Rita, Senior Staff member here at Sanctuary Rocks. In-world, I divide my time between the high-energy live music scene and my creative passions. My goal is to ensure our community always enjoys a welcoming and vibrant experience. When the music stops, I switch gears to avatar styling for my brand, SLAY, or dedicate myself to our breeding sanctuary, where my daughter and I passionately take care of KittyCats breedables. Always up for a chat, a great rock playlist, and supporting the team! 🎧✨🐾",
  },
  {
    id: "host-shari",
    name: "Shari",
    role: "Host",
    image: "/images/hosts/Shari.png.jpg",
    bio: "I love all kinds of music but I especially love seeing people enjoy it and how they react to it. I've hosted off and on during my SL life with a brief stint as a dancer. I came back to hosting cause it was my true love! When I'm not laughing with the crowd and making announcements I enjoy making new friends, playing games or just hanging out at the club following local chat. Hosting has always been a great way for me to come out of my shell as I tend to be quite introverted. In RL I enjoy creating content for my YouTube crafting channel and hanging out with my orange, one-eyed kitty who's a total lovebug and an SPCA rescue! I'm a Canadian born and raised, but a permanent resident of the US, based in Florida. I love the quirkiness of the state and have gotten used to dealing with hurricanes and their aftermath! I have a weird sense of humor often at my own expense and can usually make a joke out of the most mundane comments!",
  },
  {
    id: "host-skeeter",
    name: "Skeeter",
    role: "Host",
    image: "/images/hosts/Skeeter.png.jpg",
    bio: "\"A loyal friend who is 100% down to headbang to heavy metal, provided the air conditioning is set to a crisp 62°F. Basically, a great companion, unless it's July and we're outside.\" Catch me in the mosh pit or hiding indoors until October.",
  },
  {
    id: "host-troya",
    name: "Troya",
    role: "Host",
    image: "/images/hosts/Troya.png.png",
    bio: "Hi, I am a kind of introverted person, fascinated mostly by scientific and mystical theories. I enjoy stories when they are based on science, or a mixture of vintage and new high tech. I think this might be because I have a formation based on math and physics.\n\nI consider myself a very analytical person, this brings me into trouble sometimes since I find few different meanings on what people say, but as we all know, good communication is the key :)\n\nI grew up listening to legendary rock bands since I was a teen, always attracted by the mystical sense of their songs and a hard rock background.\n\nI might look serious and quiet when around, but I do enjoy good conversations and friends. I enjoy hosting since it keeps me in touch with people of different kinds and cultures, and I have always enjoyed being part of good things, such projects and teams.\n\nTroya.",
  },
  {
    id: "host-victor",
    name: "Victor",
    role: "Host",
    image: "/images/hosts/Victor.png.jpg",
    bio: "Creating a fun and welcoming atmosphere is what I enjoy most in Second Life. As a friendly & energetic Host at Sanctuary Rocks Club, I love meeting new people, keeping conversations flowing and making every guest feel like part of our family from the moment they arrive.\n\nWhether I'm welcoming newcomers, supporting our talented DJs, promoting exciting events, or keeping local chat lively, my goal is to make every party unforgettable. Being part of Sanctuary Rocks Club allows me to help create an environment where music lovers can connect, have fun and enjoy an amazing experience together. I believe a great event is about more than just the music; it's about building friendships, sharing laughs & creating memories that keep people coming back.\n\nIf you're looking for incredible music, friendly vibes and an interactive Host who keeps the energy high, you'll probably find me on the stage at Sanctuary Rocks Club.\n\nVictor",
  },
  {
    id: "host-bre",
    name: "Bre",
    role: "Host",
    image: "/images/hosts/Bre.png.png",
    bio: "When she's not hosting at SR, you'll likely find the camera behind her, expanding her ever-growing breedable collection, or spending quality time with her wife, Lisa. Family means everything to Bre, and it's at the heart of everything she does.\n\nFeeling lucky? There's a good chance she's off at one of the many gaming sims, chasing that next big jackpot—though knowing Bre, the laughs usually come faster than the winnings!\n\nHer goofy, unpredictable personality keeps everyone on their toes. With a quick wit, infectious laugh, and a talent for cracking herself up just as much as everyone around her, you never quite know what to expect when Bre is hosting... and that's exactly what makes her so much fun to be around.",
  },
  {
    id: "host-cats",
    name: "Cats",
    role: "Host",
    image: "/images/hosts/Cats.png.png",
    bio: "I am Cats Kornfeld. On April 22, 2008 I was lured into Second Life by a friend and I never looked back. The friend taught me a lot, got me in a club which name I cannot remember and at 28 days old I had my first hosting job. The friend is long gone from SL but I stayed, and not long after my first hosting job. I found a club I always called my second home: Sanctuary Rock. Now 18 years and various owners later, I still consider the staff and VIPs from SR my extended family. And as in all families things happen and I have been away a few times but somehow I always come back.\n\nWhen I'm not hosting I like to landscape and decorate the sim I live on, go shopping or hang out with friends.\n\nIn the Real World, I live with my husband and 2 cats in The Netherlands. I am a textile and paper artist. I knit, weave, embroider and I sew (with machines and by hand). I also like to make books, journals and 3D cardboard books and little chests with 'secret compartments.' Finally I make art with Mixed Media in the Art Journals I make myself. When it doesn't rain or snow or when there isn't a heatwave I like to potter in my garden.\n\nI am a very lucky woman not having to go to a RL-job anymore because I need all the time for my hobbies. :)",
  },
  {
    id: "host-essa",
    name: "Essa",
    role: "Host",
    image: "/images/hosts/Essa.png.png",
    bio: "Southern California born and bred, I'm mischievous with a dash of brat, a little wild with a kinky streak, and always up for a good time that never seems to end. Beneath that playful side is someone who is fiercely loyal, honest, and wears her heart on her sleeve—once you've earned my heart, you have it for life, and I'll stand by you through thick and thin. Music is woven into my soul, and while I love all genres, nothing hits me quite like metal. When I'm hosting, I thrive on feeding that energy back to the crowd, dancing on stage and sharing the incredible connection that music creates. Creativity is another passion of mine, whether I'm writing poetry and short stories, crafting something new, or getting lost in a great book or movie. My little Chihuahua, Xoomer, has been my faithful sidekick through everything, and my two cats are just as spoiled and loved. I choose to look for the bright side in every situation and live each day as though it could be my last, making sure I never let life's adventures—or the people who matter most—pass me by.",
  },
  {
    id: "host-lisa",
    name: "Lisa",
    role: "Host",
    image: "/images/hosts/Lisa.png.png",
    bio: "Lisa is one of the hosts at Sanctuary Rocks Club, bringing energy, fun, and plenty of personality to the stage as she hosts alongside the club's talented DJs. Her bubbly, outgoing nature makes her a favorite with guests, creating an unforgettable atmosphere every time she's on the mic. Away from the spotlight, Lisa is also one of the Club Managers, where she's always approachable, supportive, and happy to help both staff and VIPs with any questions or assistance they may need. Lisa also enjoys collecting anything cow related whether it be land objects, cows, planters, or even clothing she wears at her home. When Lisa is not at SR she is spending time with family.",
  },
  {
    id: "host-livvy",
    name: "Livvy",
    role: "Host",
    image: "/images/hosts/Livvy.png.jpg",
    bio: "Livvy is one of the many hosts at Sanctuary Rocks Club, bringing enthusiasm, energy, and plenty of personality to the stage. She loves hosting alongside the club's awesome DJs, helping to create an unforgettable atmosphere for everyone.\n\nWhen she's not on stage, Livvy is one of the Club Managers, always happy to assist VIP members, support the team, and ensure everyone enjoys the best possible experience at Sanctuary Rocks.",
  },
  {
    id: "host-lucifer",
    name: "Lucifer",
    role: "Host",
    image: "/images/hosts/Lucifer.png.jpg",
    bio: "Lucifer is one of the newest hosts to join the Sanctuary Rocks family, but he has already made a lasting impression with his unique style and infectious energy. Whether he's introducing one of Sanctuary's incredible DJs or keeping the crowd engaged between sets, Lucifer knows how to bring the atmosphere to life. His ability to connect with the audience ensures that every event is packed with excitement from start to finish. If you see Lucifer on stage, you're guaranteed a night full of great vibes, unforgettable moments, and the true spirit of Sanctuary Rocks.",
  },
  {
    id: "host-lucy",
    name: "Lucy",
    role: "Host",
    image: "/images/hosts/Lucy.png.png",
    bio: "I'm a Fun Hosty who always welcomes people that come to the club - make sure they have a good time.\n\nI been hosting for as long as I can remember ^_^;\nI love good banter between the DJ and I, helps the set going!.\nI'm the glitter queen as well so be sure to see glitter thrown in between any sets I do!.",
  },
  {
    id: "host-raven",
    name: "Raven",
    role: "Host",
    image: "/images/hosts/Raven.png.png",
    bio: "Hey, I'm Raven W! I'm a rock and metal lover with a passion for yoga, chilling on the beach, and hanging with my cat, Steven. If you can't find me, I'm probably reading or at the bookstore (I'm a firm believer that you can never own too many books!). I love cozy spaces, witty banter, and meeting new people along the way.",
  },
  {
    id: "host-scar",
    name: "Scar",
    role: "Host",
    image: "/images/hosts/Scar.png.png",
    bio: "With more than 20 years of combined hosting experience, I have built a passion for bringing people together and creating an atmosphere where everyone feels welcome, valued, and included. I believe that great hosting is about more than just keeping the conversation going—it's about genuinely caring for the people around you, making new friends, and ensuring every guest has an unforgettable experience.\n\nMy goal is to create a fun, friendly, and positive environment where laughter, great conversations, and amazing music come together. I take pride in interacting with our guests, making everyone feel like part of the family, and keeping the energy high from the moment they arrive until the very last song.\n\nWhether I'm welcoming newcomers or catching up with familiar faces, I'm dedicated to making every event entertaining, engaging, and filled with lasting memories.",
  },
  {
    id: "host-tifani",
    name: "Tifani",
    role: "Host",
    image: "/images/hosts/Tifani.png.png",
    bio: "Hey there!!! I'm Tifani!!! I love Hosting and Dancing the Any kind of Rock and metal music I hear. I love Getting on the Stage and Working along time any of the DJs we have at the club. Listening to Rock and Metal music I sometimes just get lost Listening to the Beats and the works that are in the Song. I love working on Pictures and making Epic posters. So I may get lost in making pictures.",
  },
  {
    id: "host-imogen",
    name: "Imogen",
    role: "Host",
    image: "/images/hosts/Imogen.png.jpg",
    bio: "I love being at Sanctuary rocks because they accept me for who I am and the staff and VIPs are non-judgmental. You can have a lot of fun at SR but also when I'm there, I feel like part of the family and everyone is so supportive. Yes its great music and I love that I can listen to SR via radio in the real world. If I'm not in the club then I'm at my land listening on the radio.",
  },
  {
    id: "host-mocha",
    name: "Mocha",
    role: "Host",
    image: "/images/hosts/Mocha.png.jpg",
    bio: "Hey, I'm Mocha. Music has always been more than background noise to me—it's where I feel most alive. Music is my escape, sarcasm is my favorite language, and laughter is something I never run out of. I enjoy meeting new people, making real connections, and turning ordinary nights into unforgettable memories. Whether we're talking music, sharing a drink, or just causing a little harmless chaos, you'll usually find me right where the energy is. Life's too short for fake vibes... so if you're looking for good company and a great night, come say hi.",
  },
  {
    id: "host-tilly",
    name: "Tilly",
    role: "Host",
    image: "/images/hosts/Tilly.png.jpg",
    bio: "What you see is what you get with me, at same time I am fun, kind and loving to all. I love hosting on stage and watching everyone smile and laugh, it brings happiness to me to see this. I love horses and I love to talk about my Jimmy who is a half arab breed, along with my companion, my big lurcher deer hound/saluki. He and my horse is my world, and if im not with them you can find me normally reading a raunchy novel or two in the corner minding my own business. UK is my home in sunny Cornwall. My mind is a new adventure every day and I wonder always where my personal jouney will take me. PS IM THE TYPO QUEEN",
  },
  {
    id: "host-fanny-foofoo",
    name: "Fanny FooFoo",
    role: "Host",
    image: "/images/hosts/Fanny%20FooFoo.png.jpg",
    bio: "Hi, I'm Fanny FooFoo—hostess at Sanctuary Rocks, where the music is loud, the drinks are questionable, and bad decisions make the best stories.\n\nI'm the kind of gal who can welcome you to the club, start a dance party, accidentally enable your shopping addiction, and convince you that buying just one more outfit is practically self-care.\n\nWhen I'm not causing perfectly acceptable levels of mayhem at Sanctuary Rocks, you'll find me DJing somewhere in Second Life, making YouTube videos about Second Life tips, tricks, news, and all the wonderfully weird things this virtual world has to offer. If I'm not filming or spinning tunes, I'm probably designing clothes, exploring the grid, collecting new friends like they're rare achievements, or wandering off on another adventure because... ooh, shiny!\n\nI'm outgoing, adventurous, slightly over-caffeinated, and firmly believe laughter should be mandatory. I love meeting new people, making connections, and proving that life is way more fun when you don't take yourself too seriously.\n\nLife's too short for boring avatars and silent dance floors. So grab a drink, crank the volume to eleven, and if you here a random cry of \"WHAT COULD POSSIBLY GO WRONG?\"... yeah, that's probably me.\n\nI don't just bring the party... I bring the Foo!",
  },
];

const BIO_ENTRY_BY_NORMALIZED_NAME = new Map(
  CREW_BIOS.map((entry) => [normalizeForMatch(entry.name), entry]),
);

// Looks up a crew member's hand-edited bio entry by display name - matches
// the same way calendar/roster names are matched elsewhere (case/spacing/
// punctuation-insensitive, tolerant of a missing "DJ "/"Host " prefix).
// Returns undefined if there's no entry for this name at all.
export function findBioEntry(name: string): CrewBioEntry | undefined {
  return BIO_ENTRY_BY_NORMALIZED_NAME.get(normalizeForMatch(name));
}
