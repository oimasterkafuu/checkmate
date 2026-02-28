function render() {
  setRoomTopLeftVisible(false);
  $('#menu').css('display', 'none');
  $('#game-starting').css('display', 'none');
  $('#game').css('display', '');
  for (var d = 0; d < 4; d++) {
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < m; j++) {
        have_route[d][i][j] = false;
      }
    }
  }
  for (var i = 0; i < route.length; i++) {
    have_route[route[i].d][route[i].x][route[i].y] = true;
  }
  var ownSelected = selx >= 0 && sely >= 0 && player > 0 && grid_type[selx][sely] < 200 && grid_type[selx][sely] % 50 == player;
  var canAttackFromSelected = selx >= 0 && sely >= 0 && (ownSelected || route.length > 0);
  for (var i = 0; i < n; i++) {
    for (var j = 0; j < m; j++) {
      var cls = 's' + scale,
        txt = '';
      var ownerId = 0;
      if (grid_type[i][j] < 200) {
        if (grid_type[i][j] < 50) {
          cls += ' c' + grid_type[i][j];
          ownerId = grid_type[i][j];
        } else if (grid_type[i][j] < 100) {
          cls += ' c' + (grid_type[i][j] - 50) + ' city';
          ownerId = grid_type[i][j] - 50;
        } else if (grid_type[i][j] < 150) {
          cls += ' c' + (grid_type[i][j] - 100) + ' general';
          ownerId = grid_type[i][j] - 100;
        } else if (grid_type[i][j] < 200) {
          cls += ' c' + (grid_type[i][j] - 150) + ' swamp';
          ownerId = grid_type[i][j] - 150;
        }
        if (grid_type[i][j] % 50 == player) {
          cls += ' selectable';
        }
        if (army_cnt[i][j] || grid_type[i][j] == 50) txt = String(army_cnt[i][j]);
      } else if (grid_type[i][j] == 200) {
        cls += ' empty';
      } else if (grid_type[i][j] == 201) {
        cls += ' mountain empty';
      } else if (grid_type[i][j] == 202) {
        cls += ' fog';
      } else if (grid_type[i][j] == 203) {
        cls += ' obstacle fog';
      } else if (grid_type[i][j] == 204) {
        cls += ' swamp';
      } else if (grid_type[i][j] == 205) {
        cls += ' swamp fog';
      }
      if (i == selx && j == sely) {
        if (selt == 1) {
          cls += ' selected';
        } else {
          cls += ' selected selected50';
          txt = '50%';
        }
      } else if (canAttackFromSelected && Math.abs(i - selx) + Math.abs(j - sely) == 1 && grid_type[i][j] != 201) {
        cls += ' attackable';
      }
      if (txt.length > 0 && scale == 1) txt = '<div class="txt">' + txt + '</div>';
      for (var d = 0; d < 4; d++)
        if (have_route[d][i][j]) {
          if (scale > 1) txt += '<div class="' + dire_class[d] + '">' + dire_char[d] + '</div>';
          else txt += '<div class="' + dire_class[d] + '"><div class="txt">' + dire_char[d] + '</div></div>';
        }
      if ($('#t' + i + '_' + j).attr('class') != cls) {
        $('#t' + i + '_' + j).attr('class', cls);
      }
      var style = '';
      if (ownerId > 0) {
        var fadeProgress = Number(surrender_progress[ownerId] || 0);
        if (fadeProgress > 0) {
          style = getSurrenderMixedColor(ownerId, fadeProgress);
        }
      }
      if ($('#t' + i + '_' + j).attr('style') != style) {
        $('#t' + i + '_' + j).attr('style', style);
      }
      if ($('#t' + i + '_' + j).html() != txt) {
        $('#t' + i + '_' + j).html(txt);
      }
    }
  }
}

function update(data) {
  if (typeof data.replay != 'undefined') replay_id = data.replay;
  if (!is_replay) {
    game_ended = Boolean(data.game_end);
  }
  surrender_progress = data.surrender_progress || {};
  if (data.is_diff) {
    for (var i = 0; i * 2 < data.grid_type.length; i++) {
      var t = data.grid_type[i * 2];
      grid_type[parseInt(t / m)][t % m] = data.grid_type[i * 2 + 1];
    }
    for (var i = 0; i * 2 < data.army_cnt.length; i++) {
      var t = data.army_cnt[i * 2];
      army_cnt[parseInt(t / m)][t % m] = data.army_cnt[i * 2 + 1];
    }
  } else {
    for (var i = 0, t = 0; i < n; i++) {
      for (var j = 0; j < m; j++) {
        grid_type[i][j] = data.grid_type[t++];
      }
    }
    for (var i = 0, t = 0; i < n; i++) {
      for (var j = 0; j < m; j++) {
        army_cnt[i][j] = data.army_cnt[t++];
      }
    }
  }
  if (route.length) {
    if (data.lst_move.x != -1) {
      while (route.length) {
        var t1 = data.lst_move,
          t2 = {
            x: route[0].x,
            y: route[0].y,
            dx: route[0].x + dire[route[0].d].x,
            dy: route[0].y + dire[route[0].d].y,
            half: route[0].type == 2,
          };
        route = route.splice(1);
        if (t1.x == t2.x && t1.y == t2.y && t1.dx == t2.dx && t1.dy == t2.dy && t1.half == t2.half) break;
      }
    } else {
      while (route.length) {
        var x = route[0].x,
          y = route[0].y,
          dx = route[0].x + dire[route[0].d].x,
          dy = route[0].y + dire[route[0].d].y;
        if (
          grid_type[x][y] < 200 &&
          grid_type[x][y] % 50 == player &&
          army_cnt[x][y] > 1 &&
          grid_type[dx][dy] != 201
        )
          break;
        route = route.splice(1);
      }
    }
  }
  render();
  lb = data.leaderboard.sort(function (a, b) {
    if (a.army != b.army) return a.army > b.army ? -1 : 1;
    if (a.land != b.land) return a.land > b.land ? -1 : 1;
    if (a.class_ == 'dead') return a.dead > b.dead ? -1 : 1;
    return 0;
  });
  var th = '<tr><td>队伍</td><td>玩家</td><td>兵力</td><td>领土</td></tr>';
  for (var i = 0; i < lb.length; i++) {
    th +=
      '<tr class="' +
      lb[i].class_ +
      '"><td>' +
      lb[i].team +
      '</td><td class="leaderboard-name c' +
      lb[i].id +
      '">' +
      htmlescape(lb[i].uid) +
      '</td><td>' +
      lb[i].army +
      '</td><td>' +
      lb[i].land +
      '</td></tr>';
  }
  $('#game-leaderboard').html(th);
  $('#game-leaderboard').css('display', '');
  $('#turn-counter').html('回合 ' + Math.floor(data.turn / 2) + (data.turn % 2 == 1 ? '.' : ''));
  $('#turn-counter').css('display', '');
  if (is_replay) return;
  var replayBtn = $($('#status-alert').children()[0].children[6]);
  if (!data.game_end) {
    replayBtn.css('display', 'none');
  }
  var wasParticipant = player > 0;
  if (typeof data.kills[client_id] != 'undefined') {
    player = 0;
    route = Array();
    var killerName = String(data.kills[client_id] || '');
    var killerCode = killerName.trim();
    var lostText = '';
    if (killerCode == '挂机') {
      lostText = '<span>你已挂机。</span>';
    } else if (killerCode == '系统' || killerCode == '投降') {
      lostText = '<span>你已投降。</span>';
    } else {
      lostText =
        '<span>你被 <span style="font-family: Quicksand-Bold, HYMaQiDuo-Bold;">' + htmlescape(killerName) + '</span> 击败了。</span>';
    }
    $($('#status-alert').children()[0].children[0]).html('游戏结束');
    $($('#status-alert').children()[0].children[1]).html(lostText);
    $($('#status-alert').children()[0].children[1]).css('display', '');
    $($('#status-alert').children()[0].children[2]).css('display', 'none');
    $('#status-alert').css('display', '');
    hideSurrenderAlert();
    lost = true;
  }
  if (data.game_end) {
    player = 0;
    route = Array();
    if ($('#status-alert').css('display') == 'none') {
      if (!wasParticipant) {
        $($('#status-alert').children()[0].children[0]).html('本局已结束');
        $($('#status-alert').children()[0].children[1]).css('display', 'none');
      } else if (lost) {
        $($('#status-alert').children()[0].children[0]).html('本局已结束');
      } else {
        $($('#status-alert').children()[0].children[0]).html('你赢了');
        $($('#status-alert').children()[0].children[1]).html('<span>本局已结束。</span>');
        $($('#status-alert').children()[0].children[1]).css('display', '');
      }
    }
    $('#status-alert').css('display', '');
    hideSurrenderAlert();
    $($('#status-alert').children()[0].children[2]).css('display', 'none');
    replayBtn.css('display', replay_id ? '' : 'none');
  }
}
