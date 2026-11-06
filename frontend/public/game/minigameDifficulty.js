// Each game reads its rules and visible instructions from this one configuration.
(function () {
  'use strict';
  var levels = {
    easy: {
      label: '쉬움',
      catch_waxon: { seconds: 5, birds: 9, minSize: 64, maxSize: 126, speed: 0.70 },
      avoid_professor: { lives: 4, fallSpeed: 0.70, dropStartMs: 1400, dropMinMs: 650, secondAt: 20, hitScale: 0.65 },
      sort_characters: { seconds: 75, lives: 5 }
    },
    normal: {
      label: '보통',
      catch_waxon: { seconds: 5, birds: 9, minSize: 42, maxSize: 110, speed: 1.00 },
      avoid_professor: { lives: 3, fallSpeed: 0.85, dropStartMs: 1150, dropMinMs: 500, secondAt: 15, hitScale: 0.72 },
      sort_characters: { seconds: 60, lives: 3 }
    },
    hard: {
      label: '어려움',
      catch_waxon: { seconds: 5, birds: 9, minSize: 34, maxSize: 96, speed: 1.25 },
      avoid_professor: { lives: 3, fallSpeed: 1.00, dropStartMs: 950, dropMinMs: 380, secondAt: 10, hitScale: 0.80 },
      sort_characters: { seconds: 45, lives: 2 }
    }
  };
  var requested = new URLSearchParams(location.search).get('difficulty');
  var key = Object.prototype.hasOwnProperty.call(levels, requested) ? requested : 'normal';
  window.AntSurvivalDifficulty = { key: key, label: levels[key].label, games: levels[key] };
})();
