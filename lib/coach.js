const coaches = {
  max: {
    id: 'max',
    name: 'Coach Max',
    images: {
      base: '/assets/coaches/max/coach-test.png'
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
      distraction_1: [
        "HEY! STOP GETTING DISTRACTED AND GET BACK TO WORK!"
      ],
      distraction_2: [
        "ARE YOU KIDDING ME? AGAIN? FOCUS ON YOUR WORK!!!"
      ],
      distraction_3: [
        "WHAT IS WRONG WITH YOU? FOCUS ON YOUR WORK!!!!"
      ],
      distraction_infinity: [
        "I CAN'T BELIEVE YOU KEEP GETTING DISTRACTED! FOCUS ON YOUR WORK NOW!!!!!"
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
  let response = {}

  const phrases = selectedCoach.phrases[context];
  if (phrases && phrases.length > 0) {
    const randomIndex = Math.floor(Math.random() * phrases.length);
    response.phrase = phrases[randomIndex];
  };

  response.image = chrome.runtime.getURL(selectedCoach.images.base);

  return response;
}