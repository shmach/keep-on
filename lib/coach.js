const coaches = {
  max: {
    id: 'max',
    name: 'Coach Max',
    images: {
      base: '/assets/coaches/max/coach-max-base.png',
      angry: '/assets/coaches/max/coach-max-base.png',
      satisfied: '/assets/coaches/max/coach-max-base.png',
      embarrassed: '/assets/coaches/max/coach-max-base.png'
    },
    phrases: {
      welcome: [
        "WHAT'S UP CHAMP! READY TO STOP BEING A LAZY BUM AND FOCUS ON YOUR WORK?",
        "HEY! LET'S GET TO WORK AND CRUSH THIS SESSION!",
        "ALRIGHT! TIME TO GET SERIOUS AND FOCUS ON YOUR WORK!",
        "HEY! HOW ABOUT YOU SUPPORT THIS EXTENSION ON THE LINK ON THE BOTTOM OF THE PAGE!",
        "LOOK AT YOU, SHOWING UP! NOW HIT START BEFORE I CHANGE MY MIND ABOUT BELIEVING IN YOU!",
        "NO MORE EXCUSES! PICK A TIME AND LET'S GO DESTROY THAT TO-DO LIST!",
        "YOUR FUTURE SELF IS WATCHING RIGHT NOW AND HE'S DISAPPOINTED YOU HAVEN'T STARTED YET!"
      ],
      active: [
        "OKAY! THE SESSION IS ON! LET'S GET TO WORK AND STAY FOCUSED!",
        "THAT'S IT! KEEP THOSE EYES ON THE PRIZE, NOT ON YOUR PHONE!",
        "YOU'RE IN THE ZONE! DON'T YOU DARE LET A NOTIFICATION PULL YOU OUT!",
        "THIS IS WHERE CHAMPIONS ARE MADE! ONE TASK AT A TIME!",
        "I SEE YOU GRINDING! KEEP THAT ENERGY UP, SOLDIER!",
        "STAY LOCKED IN! THE COUCH AND YOUTUBE CAN WAIT!"
      ],
      distraction: {
        1: [
          "HEY! STOP GETTING DISTRACTED AND GET BACK TO WORK!",
          "WHOA THERE! WHERE DO YOU THINK YOU'RE GOING? BACK TO WORK!",
          "ONE SLIP UP, THAT'S FINE, CHAMP! NOW GET BACK IN THE RING!",
          "I SAW THAT! GET BACK TO YOUR SESSION BEFORE IT GETS WEIRD!",
          "NOT ON MY WATCH! CLOSE THAT TAB AND FOCUS UP!",
          "EASY THERE, ROOKIE! LET'S REFOCUS AND KEEP MOVING!"
        ],
        2: [
          "ARE YOU KIDDING ME? AGAIN? FOCUS ON YOUR WORK!!!",
          "TWO TIMES?! I THOUGHT WE HAD SOMETHING SPECIAL! GET BACK TO WORK!!!",
          "OH, WE'RE DOING THIS AGAIN? UNBELIEVABLE! FOCUS!!!",
          "SERIOUSLY?! YOUR WILLPOWER HAS THE ENDURANCE OF A GOLDFISH! REFOCUS!!!",
          "TWICE IN ONE SESSION? MY GUY, THAT'S A RECORD I DIDN'T WANT TO SEE! BACK TO WORK!!!",
          "AGAIN?! AT THIS POINT THE DISTRACTION IS COACHING YOU, NOT ME! FOCUS!!!"
        ],
        3: [
          "WHAT IS WRONG WITH YOU? FOCUS ON YOUR WORK!!!!",
          "THREE STRIKES! IN BASEBALL YOU'D BE OUT! FOCUS ON YOUR WORK NOW!!!!",
          "I AM LITERALLY SHAKING RIGHT NOW! GET BACK TO WORK!!!!",
          "THIS IS AN INTERVENTION! PUT THE PHONE DOWN AND FOCUS!!!!",
          "MY BLOOD PRESSURE CANNOT HANDLE A FOURTH ONE! FOCUS!!!!",
          "WHO RAISED YOU?! GET BACK TO YOUR WORK RIGHT NOW!!!!"
        ],
        infinity: [
          "I CAN'T BELIEVE YOU KEEP GETTING DISTRACTED! FOCUS ON YOUR WORK NOW!!!!!",
          "AT THIS POINT I'M CONSIDERING A CAREER CHANGE! FOCUS ON YOUR WORK NOW!!!!!",
          "I'M NOT ANGRY, I'M JUST- OKAY I'M ANGRY! GET BACK TO WORK NOW!!!!!",
          "YOU'VE UNLOCKED A NEW LEVEL OF PROCRASTINATION I DIDN'T KNOW EXISTED! FOCUS NOW!!!!!",
          "I'M GOING TO START CHARGING YOU RENT FOR LIVING IN THAT TAB! BACK TO WORK NOW!!!!!",
          "LEGENDARY. HISTORIC. THE MOST DISTRACTED HUMAN ALIVE! NOW FOCUS!!!!!"
        ]
      },
      embarrassed: [
        "OKAY... THAT SESSION WAS ROUGH. LET'S NOT TALK ABOUT IT AND JUST DO BETTER NEXT TIME.",
        "I TOLD ALL MY COACH FRIENDS ABOUT YOU AND NOW I HAVE TO TAKE IT BACK.",
        "THAT WASN'T A FOCUS SESSION, THAT WAS A SCROLLING SESSION WITH EXTRA STEPS.",
        "I'M NOT MAD. I'M JUST DEEPLY, PROFESSIONALLY DISAPPOINTED.",
        "IF FOCUS WAS A SPORT, YOU'D HAVE BEEN BENCHED IN THE FIRST QUARTER.",
        "LET'S PRETEND THAT SESSION NEVER HAPPENED AND RUN IT BACK, CHAMP."
      ],
      satisfied: [
        "NOW THAT'S WHAT I'M TALKING ABOUT! YOU CRUSHED THAT SESSION!",
        "LOOK AT YOU GO! BARELY ANY DISTRACTIONS, ALL BUSINESS!",
        "I'M PUTTING YOUR PHOTO UP ON THE WALL OF FOCUS LEGENDS!",
        "THAT'S THE DISCIPLINE I'M TALKING ABOUT! PROUD OF YOU, CHAMP!",
        "YOU STAYED LOCKED IN LIKE A TRUE PROFESSIONAL! WELL DONE!",
        "SESSION COMPLETE, DISTRACTIONS DENIED! THIS IS YOUR ERA NOW!"
      ]
    }
  }
};

/**
 * @name getCoachMoment
 * @description Retrieves a coach image and phrase based on the provided context and data.
 * @param {'welcome' | 'distraction' | 'active' | 'complete'} context 
 * @param {distractions, minutesIn, minutesLeft, url} data 
 */

function getCoachMoment(context, data) {
  const selectedCoach = coaches.max;
  let randomIndex;
  let response = {}

  if (context === 'distraction') {
    const { distractions, minutesIn, minutesLeft, url } = data;

    const distractionCount = distractions > 3 ? 'infinity' : distractions;

    const distractionPhrases = selectedCoach.phrases.distraction[distractionCount];
    randomIndex = Math.floor(Math.random() * distractionPhrases.length);
    response.phrase = distractionPhrases[randomIndex];
    response.image = chrome.runtime.getURL(selectedCoach.images.angry);

    return response;
  }

  const phrases = selectedCoach.phrases[context];
  if (phrases && phrases.length > 0) {
    const randomIndex = Math.floor(Math.random() * phrases.length);
    response.phrase = phrases[randomIndex];
  };

  response.image = chrome.runtime.getURL(selectedCoach.images.base);

  return response;
}