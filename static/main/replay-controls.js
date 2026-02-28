function backTurn() {
  if (is_autoplaying) switchAutoplay();
  if (!replay_data || !replay_data.patches || cur_turn <= 0) {
    return false;
  }
  var patch = replay_data.patches[cur_turn - 1];
  if (!patch || !patch.backward) {
    return false;
  }
  update(patch.backward);
  cur_turn -= 1;
  return true;
}

function nextTurn(ignore = false) {
  if (is_autoplaying && !ignore) return false;
  if (!replay_data || !replay_data.patches || cur_turn >= replay_data.patches.length) {
    return false;
  }
  var patch = replay_data.patches[cur_turn];
  if (!patch || !patch.forward) {
    return false;
  }
  update(patch.forward);
  cur_turn += 1;
  return true;
}

function jumpToTurn() {
  if (is_autoplaying) switchAutoplay();
  var uturn = $('#replay-turn-jump-input').val(),
    turn = 0;
  if (!replay_data || !replay_data.patches || !replay_data.initial) {
    return;
  }
  if (!uturn || uturn.length == 0) {
    return;
  }
  if (uturn[uturn.length - 1] == '.') turn = parseInt(uturn.substr(0, uturn.length - 1)) * 2 + 1;
  else turn = parseInt(uturn) * 2;
  if (isNaN(turn)) {
    return;
  }
  var targetFrame = -1;
  if (replay_data.initial.turn == turn) {
    targetFrame = 0;
  } else {
    for (var i = 0; i < replay_data.patches.length; i++) {
      if (replay_data.patches[i].forward.turn == turn) {
        targetFrame = i + 1;
        break;
      }
    }
  }
  if (targetFrame < 0) {
    return;
  }
  while (cur_turn < targetFrame) {
    if (!nextTurn(true)) break;
  }
  while (cur_turn > targetFrame) {
    if (!backTurn()) break;
  }
}

function switchAutoplay(keepRateTabsVisible = false) {
  is_autoplaying = !is_autoplaying;
  if (!is_autoplaying) {
    $($('#replay-top-left')[0].children[1]).attr('class', 'small');
    $('#tabs-replay-autoplay').css('display', keepRateTabsVisible ? 'inline-block' : 'none');
    return;
  }
  $($('#replay-top-left')[0].children[1]).attr('class', 'small inverted');
  $('#tabs-replay-autoplay').css('display', 'inline-block');
  setTimeout(autoplay, 500 / autoplay_speed);
}

function autoplay() {
  if (!is_autoplaying) return;
  if (!nextTurn(true)) {
    switchAutoplay(true);
    return;
  }
  setTimeout(autoplay, 500 / autoplay_speed);
}

function setAutoplayRate() {
  var tmp = $($('#tabs-replay-autoplay')[0].children[0]).val();
  autoplay_speed = parseFloat(tmp.substr(0, tmp.length - 1));
}

function _exit() {
  if (typeof allow_page_leave != 'undefined') {
    allow_page_leave = true;
  }
  location.href = '/';
}

function canSurrender() {
  return in_game && !is_replay && player > 0 && !lost;
}

function showSurrenderAlert() {
  if (!canSurrender()) {
    hideSurrenderAlert();
    return;
  }
  $('#surrender-alert').css('display', '');
}

function hideSurrenderAlert() {
  $('#surrender-alert').css('display', 'none');
}
