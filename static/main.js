//map format
//n,m,turn
//grid_type[n][m] byte 0~49=army 50~99=city 100~149=generals 150~199=swamp with army 200=empty 201=mountain 202=fog 203=obstacle 204=swamp 205=swamp+fog
//army_cnt[n][m] int

$(document).ready(function () {
  ((x = -1), (y = -1));
  $('body').on('mousedown', function (e) {
    ((x = e.pageX), (y = e.pageY));
  });
  $('body').on('mousemove', function (e) {
    var w, X, Y;
    if (typeof e.originalEvent.buttons == 'undefined') {
      w = e.which;
    } else {
      w = e.originalEvent.buttons;
    }
    X = e.clientX || e.originalEvent.clientX;
    Y = e.clientY || e.originalEvent.clientY;
    if (w == 1) {
      $('#map').css('left', parseInt($('#map').css('left')) - x + X);
      $('#map').css('top', parseInt($('#map').css('top')) - y + Y);
      ((x = e.pageX), (y = e.pageY));
    }
  });
  var touches = [],
    expected_scale;
  function startTouch(s) {
    expected_scale = scale_sizes[scale];
    if (s.length <= 2) touches = s;
    else touches = [];
  }
  function handleMove(s) {
    var x = touches[0].pageX,
      y = touches[0].pageY,
      X = s[0].pageX,
      Y = s[0].pageY;
    $('#map').css('left', parseInt($('#map').css('left')) - x + X);
    $('#map').css('top', parseInt($('#map').css('top')) - y + Y);
  }
  function dis(a, b) {
    return Math.sqrt((a.pageX - b.pageX) * (a.pageX - b.pageX) + (a.pageY - b.pageY) * (a.pageY - b.pageY));
  }
  function moveTouch(s) {
    console.log(s);
    if (touches.length == 0) return;
    if (touches.length == 1) {
      if (s.length == 1) {
        handleMove(s);
        touches = s;
      } else if (s.length == 2) {
        var dis1 = dis(touches[0], s[0]),
          dis2 = dis(touches[0], s[1]);
        if (dis1 > dis2) s = [s[1], s[0]];
        handleMove(s);
        touches = s;
      } else {
        touches = [];
      }
    } else {
      if (s.length == 1) {
        var dis1 = dis(touches[0], s[0]),
          dis2 = dis(touches[1], s[0]);
        if (dis1 > dis2) touches = [touches[1], touches[0]];
        handleMove(s);
        touches = s;
      } else if (s.length == 2) {
        var x = (touches[0].pageX + touches[1].pageX) / 2,
          y = (touches[0].pageY + touches[1].pageY) / 2;
        var X = (s[0].pageX + s[1].pageX) / 2,
          Y = (s[0].pageY + s[1].pageY) / 2;
        $('#map').css('left', parseInt($('#map').css('left')) - x + X);
        $('#map').css('top', parseInt($('#map').css('top')) - y + Y);
        var dis1 = dis(touches[0], touches[1]),
          dis2 = dis(s[0], s[1]);
        expected_scale *= dis2 / dis1;
        if (expected_scale.toString().toLowerCase().indexOf('n') != -1) {
          expected_scale = scale_sizes[scale];
        } else {
          var pos,
            mi = 200;
          for (var i = 1; i < scale_sizes.length; i++) {
            var t = Math.abs(scale_sizes[i] - expected_scale);
            if (t < mi) ((mi = t), (pos = i));
          }
          if (pos != scale) {
            scale = pos;
            if (typeof localStorage != 'undefined') {
              localStorage.scale = scale.toString();
            }
            render();
          }
        }
        touches = s;
      } else {
        touches = [];
      }
    }
  }
  function endTouch() {
    touches = [];
  }
  function bindTouch(obj) {
    obj.addEventListener(
      'touchstart',
      function (e) {
        if (!in_game) return;
        startTouch(e.targetTouches);
      },
      false,
    );
    obj.addEventListener(
      'touchmove',
      function (e) {
        if (!in_game) return;
        moveTouch(e.targetTouches);
      },
      false,
    );
    obj.addEventListener(
      'touchend',
      function (e) {
        if (!in_game) return;
        moveTouch(e.targetTouches);
        endTouch();
      },
      false,
    );
  }
  bindTouch(document);

  if (window.innerWidth <= 1000) {
    // shoule be mobile
    $('#turn-counter').attr('class', 'mobile');
    $('#game-leaderboard').attr('class', 'mobile');
    $('#replay-top-left').attr('class', 'mobile');
  }
});

const scale_sizes = [0, 20, 25, 32, 40, 50, 60];

var n,
  m,
  turn,
  player,
  scale,
  selx,
  sely,
  selt,
  in_game = false;
var grid_type,
  army_cnt,
  have_route = Array(4);
var surrender_progress = {};
var route;

var room_id = '',
  account_name = '',
  client_id,
  ready_state = 0,
  lost;
var allow_page_leave = false,
  game_ended = false;
var max_teams = 16;
var room_link_copy_timer = 0;

var chat_focus = false,
  is_team = false,
  starting_audio;

var is_replay = false,
  replay_id = false,
  replay_data = [],
  rcnt = 0,
  cur_turn = 0,
  is_autoplaying = false,
  autoplay_speed = 1;

window.addEventListener('beforeunload', function (e) {
  if (allow_page_leave || is_replay || !in_game || game_ended) return;
  e.preventDefault();
  e.returnValue = '';
  return '';
});

if (location.pathname.substr(0, 8) == '/replays') {
  is_replay = true;
  replay_id = location.pathname.substr(9);
  fetch('/api/getreplay/' + replay_id)
    .then(function (res) {
      if (!res.ok) {
        throw new Error('load failed');
      }
      return res.arrayBuffer();
    })
    .then(function (buf) {
      replay_data = decodeReplayBinary(buf);
      replayStart();
    })
    .catch(function () {
      location.href = '/replays';
    });
}

function replayStart() {
  rcnt++;
  if (rcnt == 2) {
    init_map(replay_data.n, replay_data.m);
    in_game = true;
    cur_turn = 0;
    update(replay_data.initial);
  }
}

function init_map(_n, _m, general) {
  chat_focus = false;
  $('#chatroom-input').blur();
  ((n = _n), (m = _m));
  grid_type = Array(n);
  for (var i = 0; i < n; i++) {
    grid_type[i] = Array(m);
  }
  army_cnt = Array(n);
  for (var i = 0; i < n; i++) {
    army_cnt[i] = Array(m);
  }
  for (var d = 0; d < 4; d++) {
    have_route[d] = Array(n);
    for (var i = 0; i < n; i++) {
      have_route[d][i] = Array(m);
    }
  }
  route = Array();
  ((selx = -1), (sely = -1), (selt = 1));

  var ts = '';
  for (var i = 0; i < n; i++) {
    ts += '<tr>';
    for (var j = 0; j < m; j++) {
      ts += '<td id="t' + i + '_' + j + '"></td>';
    }
    ts += '</tr>';
  }
  $('#map').html('<table><tbody>' + ts + '</table></tbody>');

  if (!general || general[0] == -1) {
    general = [n / 2 - 0.5, m / 2 - 0.5];
  }
  $('#map').css('left', $(document).width() / 2 + (m / 2 - general[1] - 0.5) * scale_sizes[scale] + 'px');
  $('#map').css('top', $(document).height() / 2 + (n / 2 - general[0] - 0.5) * scale_sizes[scale] + 'px');
  for (var i = 0; i < n; i++) {
    for (var j = 0; j < m; j++) {
      $('#t' + i + '_' + j).on('click', Function('click(' + i + ',' + j + ')'));
    }
  }
}

function click(x, y) {
  if (x < 0 || y < 0 || x >= n || y >= m) return;
  var ownCell = player > 0 && grid_type[x][y] < 200 && grid_type[x][y] % 50 == player;
  if (!is_replay && !ownCell) {
    ((selx = -1), (sely = -1), (selt = 1));
    render();
    return;
  }
  ((selx = x), (sely = y), (selt = 1));
  render();
}

function moveSelected(d) {
  if (selx < 0 || sely < 0 || d < 0 || d >= dire.length) return;
  var ownSelected = player > 0 && grid_type[selx][sely] < 200 && grid_type[selx][sely] % 50 == player;
  if (!ownSelected && route.length == 0) return;
  var nx = selx + dire[d].x,
    ny = sely + dire[d].y;
  if (nx < 0 || ny < 0 || nx >= n || ny >= m) return;
  if (grid_type[nx][ny] == 201) return;
  addroute(selx, sely, d, selt);
  ((selx = nx), (sely = ny), (selt = 1));
  render();
}

function keypress(key) {
  if (in_game && is_replay) {
    if (key == 'a' || key == 37) {
      backTurn();
    } else if (key == 'd' || key == 39) {
      nextTurn();
    } else if (key == ' ') {
      switchAutoplay();
    }
  } else if (in_game) {
    if (key == 27) {
      if (!canSurrender()) {
        hideSurrenderAlert();
        return;
      }
      if ($('#surrender-alert').css('display') == 'none') showSurrenderAlert();
      else hideSurrenderAlert();
    } else if (key == 'z') {
      selt = 3 - selt;
      render();
    } else if (key == 'w' || key == 38) {
      moveSelected(0);
    } else if (key == 's' || key == 40) {
      moveSelected(1);
    } else if (key == 'a' || key == 37) {
      moveSelected(2);
    } else if (key == 'd' || key == 39) {
      moveSelected(3);
    } else if (key == 'q') {
      clear_queue();
    } else if (key == 'e') {
      pop_queue();
    } else if (key == 't') {
      if (!chat_focus) {
        is_team = true;
        setTimeout(function () {
          $('#chatroom-input').focus();
          checkChat();
        }, 0);
      }
    } else if (key == 13) {
      if (!chat_focus) {
        is_team = false;
        setTimeout(function () {
          $('#chatroom-input').focus();
          checkChat();
        }, 0);
      }
    } else if (key == ' ') {
      ((selx = -1), (sely = -1), (selt = 1));
      render();
    }
  } else if (!is_replay) {
    if (key == 13 && !chat_focus) {
      is_team = false;
      setTimeout(function () {
        $('#chatroom-input').focus();
        checkChat();
      }, 0);
    }
  }
}

function submitChatInput() {
  var text = chatStr.trim();
  if (text.length === 0) {
    chatStr = '';
    is_team = false;
    $('#chatroom-input').val('');
    $('#chatroom-input').blur();
    return;
  }
  socket.emit('send_message', { text: text, team: is_team });
  ((chatStr = ''), (is_team = false));
  $('#chatroom-input').val('');
}

function setRoomTopLeftVisible(show) {
  $('#room-top-left').css('display', show ? '' : 'none');
}

$(document).ready(function () {
  $('body').on('keypress', function (e) {
    keypress(e.key.toLowerCase());
  });
  $('body').on('keydown', function (e) {
    keypress(e.keyCode);
  });
  $('#map_back').on('click', function (e) {
    ((selx = -1), (sely = -1), (selt = 1));
    render();
  });
  $('body').bind('mousewheel', function (e) {
    if (in_game) {
      if (e.originalEvent.deltaY > 0) {
        scale = Math.max(scale - 1, 1);
      } else {
        scale = Math.min(scale + 1, 6);
      }
      if (typeof localStorage != 'undefined') {
        localStorage.scale = scale.toString();
      }
      render();
    }
  });
  if (typeof localStorage != 'undefined') {
    if (typeof localStorage.scale == 'undefined') {
      localStorage.scale = '3';
    }
    scale = parseInt(localStorage.scale);
  }
});

if (!is_replay) {
  var socket = io.connect(location.origin, { transports: ['websocket', 'polling'] });
} else {
  function socket() {}
  socket.on = function () {};
}

async function loadAccountProfile() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) throw '';
    const data = await res.json();
    account_name = data.username;
  } catch {
    location.href = '/login';
  }
}

socket.on('update', update);

socket.on('starting', function () {
  setRoomTopLeftVisible(false);
  $('#status-alert').css('display', 'none');
  $($('#status-alert').children()[0].children[6]).css('display', 'none');
  hideSurrenderAlert();
  $('#menu').css('display', 'none');
  $('#game-starting').css('display', '');
  starting_audio.play();
});

function addroute(x, y, d, type) {
  route.push({ x: x, y: y, d: d, type: type });
  socket.emit('attack', { x: x, y: y, dx: x + dire[d].x, dy: y + dire[d].y, half: type == 2 });
  render();
}

function clear_queue() {
  route = Array();
  socket.emit('clear_queue');
  render();
}

function pop_queue() {
  if (route.length) {
    var tmp = route.pop();
    socket.emit('pop_queue');
    if (tmp.x + dire[tmp.d].x == selx && tmp.y + dire[tmp.d].y == sely) {
      ((selx = tmp.x), (sely = tmp.y));
    }
    render();
  }
}

socket.on('set_id', function (data) {
  client_id = data;
});

socket.on('init_map', function (data) {
  init_map(data.n, data.m, data.general);
  in_game = true;
  game_ended = false;
  lost = false;
  player = 0;
  $('#status-alert').css('display', 'none');
  hideSurrenderAlert();
  console.log(data);
  for (var i = 0; i < data.player_ids.length; i++) {
    if (data.player_ids[i] == client_id) {
      player = i + 1;
    }
  }
});

$(document).ready(function () {
  if (is_replay) {
    $('#replay-top-left').css('display', '');
    $('#replay-bottom').css('display', '');
    $('#replay-turn-jump-input').on('keypress', function (e) {
      if (e.charCode == 10 || e.charCode == 13) jumpToTurn();
    });
    $('#replay-turn-jump-button').on('click', jumpToTurn);
    $($('#replay-bottom-bar')[0].children[0]).on('click', backTurn);
    $($('#replay-bottom-bar')[0].children[1]).on('click', switchAutoplay);
    $($('#replay-bottom-bar')[0].children[2]).on('click', nextTurn);
    $($('#replay-top-left')[0].children[1]).on('click', switchAutoplay);
    $($('#replay-top-left')[0].children[2]).on('click', _exit);
    $('#tabs-replay-autoplay').each(function () {
      for (var i = 1; i < this.children.length; i++) {
        initTab(this, this.children[i], setAutoplayRate);
      }
    });
    replayStart();
    return;
  }
  $('#chat').css('display', '');
  $('#menu').css('display', '');
  setRoomTopLeftVisible(true);
  var tmp = location.pathname;
  room_id = tmp.substr(tmp.indexOf('games/') + 6);
  refreshRoomLinkDisplay();
  starting_audio = new Audio('/gong.mp3');
  loadAccountProfile().then(function () {
    joinGameRoom();
  });
});

socket.on('connect', function () {
  joinGameRoom();
});

socket.on('connect_error', function () {
  location.href = '/login';
});
socket.on('disconnect', function (reason) {
  if (reason == 'io server disconnect') {
    location.href = '/';
  }
});

socket.on('room_update', function (data) {
  setTabVal('game-speed', data.speed + 'x');
  setAllowTeamModeByCode(Boolean(data.allow_team));
  setMapModeByCode(data.map_mode || 'random');
  refreshMapInputHint();
  $('#map-token').val(normalizeMapTokenInput(data.map_token || ''));
  var tmp = Array(max_teams + 1);
  for (var i = 0; i <= max_teams; i++) {
    tmp[i] = '';
  }
  var isHost = data.players.length > 0 && data.players[0].sid == client_id;
  var allowTeam = Boolean(data.allow_team);
  var roomRunning = Boolean(data.in_game);
  setTabGroupReadonly('tabs-game-speed', roomRunning || !isHost);
  setTabGroupReadonly('tabs-map-mode', roomRunning || !isHost);
  setTabGroupReadonly('tabs-team-mode', roomRunning || !isHost);
  $('#team-mode-section').css('display', isHost && !roomRunning ? '' : 'none');
  if (isHost && !roomRunning) $('#map-token').removeAttr('disabled');
  else $('#map-token').attr('disabled', '');
  $('#host-' + isHost.toString()).css('display', '');
  $('#host-' + (!isHost).toString()).css('display', 'none');

  var playingCount = 0;
  var selfTeam = 0;
  var selfReady = false;
  for (var i = 0; i < data.players.length; i++) {
    if (data.players[i].team) playingCount += 1;
    if (data.players[i].sid == client_id) {
      selfTeam = data.players[i].team;
      selfReady = Boolean(data.players[i].ready && data.players[i].team !== 0);
      if (data.players[i].team) {
        $('#you-are').css('display', '');
        $('#you-are-2').css('display', '');
        $($('#you-are')[0].children[1]).attr('class', 'inline-color-block c' + (i + 1));
        $($('#you-are-2')[0].children[1]).attr('class', 'inline-color-block c' + (i + 1));
      } else {
        $('#you-are').css('display', 'none');
        $('#you-are-2').css('display', 'none');
      }
    }
    var groupId = allowTeam ? data.players[i].team : data.players[i].team ? 1 : 0;
    tmp[groupId] += '<div>';
    if (groupId) {
      if (i == 0) {
        tmp[groupId] += '<span class="inline-color-block">' + crown_html + '</span>';
      } else {
        tmp[groupId] += '<span class="inline-color-block c' + (i + 1) + '"></span>';
      }
    }
    tmp[groupId] += '<p>';
    if (data.players[i].ready) tmp[groupId] += '<u>';
    if (i == 0) tmp[groupId] += '<b>';
    tmp[groupId] += htmlescape(data.players[i].uid);
    if (i == 0) tmp[groupId] += '</b>';
    if (data.players[i].ready) tmp[groupId] += '</u>';
    tmp[groupId] += '</p>';
    tmp[groupId] += '</div>';
  }

  var canSelectPlayer = selfTeam != 0 || playingCount < max_teams;
  $('#team-select-section').css('display', !roomRunning && canSelectPlayer ? '' : 'none');
  setTabGroupReadonly('tabs-custom-team', roomRunning || !canSelectPlayer);
  refreshCustomTeamTabs(allowTeam);
  setTabVal('custom-team', selfTeam ? (allowTeam ? selfTeam.toString() : '参赛') : '观战');
  ready_state = selfReady ? 1 : 0;

  if (allowTeam) {
    for (var i = 0; i <= max_teams; i++) {
      if (tmp[i] != '') {
        tmp[i] =
          '<div class="custom-team-container"><h4>' +
          (i ? '队伍 ' + i : '观战席') +
          '</h4>' +
          tmp[i] +
          '</div>';
      }
    }
    var res_html = '';
    for (var i = 1; i <= max_teams; i++) {
      res_html += tmp[i];
    }
    res_html += tmp[0];
    $('#teams').html(res_html);
  } else {
    var compact_html = '';
    if (tmp[1] != '') {
      compact_html += '<div class="custom-team-container"><h4>参赛者</h4>' + tmp[1] + '</div>';
    }
    if (tmp[0] != '') {
      compact_html += '<div class="custom-team-container"><h4>观众席</h4>' + tmp[0] + '</div>';
    }
    $('#teams').html(compact_html);
  }

  if (!roomRunning && data.need > 1) {
    $('#force-start').css('display', 'block');
    $('#force-start').html('强制开局 ' + data.ready + ' / ' + data.need);
  } else {
    ready_state = 0;
    $('#force-start').css('display', 'none');
  }
  if (!roomRunning && data.need > 1 && ready_state) {
    $('#force-start').attr('class', 'inverted');
  } else {
    $('#force-start').attr('class', '');
  }
});

$(document).ready(function () {
  $('#tabs-game-speed').each(function () {
    for (var i = 1; i < this.children.length; i++) {
      initTab(this, this.children[i], function () {
        updateConfPatch({ speed: parseFloat(getTabVal('game-speed')) });
      });
    }
  });
  $('#tabs-map-mode').each(function () {
    for (var i = 1; i < this.children.length; i++) {
      initTab(this, this.children[i], function () {
        refreshMapInputHint();
        updateConfPatch({ map_mode: getMapModeCode() });
      });
    }
  });
  $('#tabs-team-mode').each(function () {
    for (var i = 1; i < this.children.length; i++) {
      initTab(this, this.children[i], function () {
        updateConfPatch({ allow_team: getAllowTeamModeCode() });
      });
    }
  });
  $('#tabs-custom-team').each(function () {
    for (var i = 1; i < this.children.length; i++) {
      initTab(this, this.children[i], updateTeam);
    }
  });
  $('#force-start').on('click', function () {
    ready_state ^= 1;
    socket.emit('change_ready', { ready: ready_state });
  });
  $('#map-token').on('change', delayUpdateMapToken);
  $('#map-token').on('input', delayUpdateMapToken);
  $('#room-link-display').on('click', copyRoomLink);
  $('#room-home-btn').on('click', _exit);
});

socket.on('left', function () {
  $('#menu').css('display', '');
  setRoomTopLeftVisible(true);
  $('#game').css('display', 'none');
  $('#game-leaderboard').css('display', 'none');
  $('#turn-counter').css('display', 'none');
  $('#chat-messages-container').html('');
  $('#status-alert').css('display', 'none');
  $($('#status-alert').children()[0].children[6]).css('display', 'none');
  hideSurrenderAlert();
  ready_state = 0;
  in_game = false;
  game_ended = false;
  replay_id = false;
});

$(document).ready(function () {
  var collapsed = true;
  $('#chat-messages-container').attr('class', 'minimized');
  $('#chatroom-input').attr('class', 'minimized');
  $('#chat-messages-container').on('click', function () {
    collapsed = !collapsed;
    $('#chat-messages-container').attr('class', collapsed ? 'minimized' : '');
    $('#chatroom-input').attr('class', collapsed ? 'minimized' : '');
  });
  socket.on('chat_message', function (data) {
    var th = '';
    if (data.color) {
      th =
        '<span class="inline-color-block c' +
        data.color +
        '"></span><span class="username">' +
        htmlescape(data.sender) +
        '</span>: ' +
        htmlescape(data.text) +
        '</p>';
      if (data.team) {
        th = '<span style="font-family:Quicksand-Bold">' + teamPrefix + '</span>' + th;
      }
      th = '<p class="chat-message">' + th;
    } else {
      th = '<p class="chat-message server-chat-message">' + htmlescape(data.text) + '</p>';
    }
    $('#chat-messages-container')[0].innerHTML += th;
    $('#chat-messages-container').scrollTop(233333);
  });
  $('#chatroom-input').on('keydown', function (data) {
    if (data.keyCode != 13) return;
    data.preventDefault();
    data.stopPropagation();
    submitChatInput();
  });
  $('#chatroom-input').focus(function () {
    chat_focus = true;
  });
  $('#chatroom-input').blur(function () {
    chat_focus = false;
    is_team = false;
    checkChat();
  });
  $('#chatroom-input').on('change', checkChat);
  $('#chatroom-input').on('input', checkChat);
  $($('#status-alert').children()[0].children[2]).on('click', function (e) {
    $('#status-alert').css('display', 'none');
  });
  $($('#status-alert').children()[0].children[4]).on('click', function (e) {
    socket.emit('return_room');
  });
  $($('#status-alert').children()[0].children[6]).on('click', function (e) {
    window.open('/replays/' + replay_id, '_blank');
  });
  $($('#status-alert').children()[0].children[8]).on('click', _exit);
  $('#surrender-confirm').on('click', function () {
    if (!canSurrender()) {
      hideSurrenderAlert();
      return;
    }
    hideSurrenderAlert();
    socket.emit('surrender');
  });
  $('#surrender-cancel').on('click', hideSurrenderAlert);
});
