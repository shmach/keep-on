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
        "HEY! HOW ABOUT YOU SUPPORT THIS EXTENSION ON THE LINK ON THE BOTTOM OF THE PAGE!"
      ],
      active: [
        "OKAY! THE SESSION IS ON! LET'S GET TO WORK AND STAY FOCUSED!"
      ],
      distraction: {
        1: [
          "HEY! STOP GETTING DISTRACTED AND GET BACK TO WORK!"
        ],
        2: [
          "ARE YOU KIDDING ME? AGAIN? FOCUS ON YOUR WORK!!!"
        ],
        3: [
          "WHAT IS WRONG WITH YOU? FOCUS ON YOUR WORK!!!!"
        ],
        infinity: [
          "I CAN'T BELIEVE YOU KEEP GETTING DISTRACTED! FOCUS ON YOUR WORK NOW!!!!!"
        ]
      }
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