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
        "HEY! LET'S GET TO WORK AND CRUSH THIS SESSION!"
      ],
      active: [
        "OKAY! THE SESSION IS ON! LET'S GET TO WORK AND STAY FOCUSED!"
      ],
      distraction_1: [
        "HEY! STOP GETTING DISTRACTED AND GET BACK TO WORK!"
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