function joinGameRoom() {
  if (room_id != '') {
    socket.emit('join_game_room', { room: room_id });
  }
}

function getRoomLink() {
  return location.origin + location.pathname;
}

function refreshRoomLinkDisplay() {
  var link = getRoomLink();
  var text = htmlescape(link);
  if (room_id && link.substr(link.length - room_id.length) == room_id) {
    var prefix = link.substr(0, link.length - room_id.length);
    text = htmlescape(prefix) + '<b>' + htmlescape(room_id) + '</b>';
  }
  $('#room-link-text').html(text);
  $('#room-link-display').attr('data-link', link);
}

function copyTextFallback(text) {
  var textarea = $('<textarea readonly></textarea>');
  textarea.css({ position: 'fixed', top: '-1000px', left: '-1000px' });
  textarea.val(text);
  $('body').append(textarea);
  textarea[0].focus();
  textarea[0].select();
  var copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {}
  textarea.remove();
  return copied;
}

function showRoomLinkCopied() {
  clearTimeout(room_link_copy_timer);
  $('#room-link-copied').stop(true, true).css('display', 'inline');
  room_link_copy_timer = setTimeout(function () {
    $('#room-link-copied').fadeOut(150);
  }, 1200);
}

async function copyRoomLink() {
  var link = $('#room-link-display').attr('data-link') || getRoomLink();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(link);
      showRoomLinkCopied();
      return;
    }
  } catch {}
  if (copyTextFallback(link)) {
    showRoomLinkCopied();
  }
}

function getMapModeCode() {
  return getTabVal('map-mode') == '峡谷回廊' ? 'maze' : 'random';
}

function setMapModeByCode(code) {
  setTabVal('map-mode', code == 'maze' ? '峡谷回廊' : '标准地图');
}

function refreshMapInputHint() {
  $('#map-input-label').html('地图随机种子：');
  $('#map-token').attr('placeholder', '留空将自动生成随机种子');
}

function getAllowTeamModeCode() {
  return getTabVal('team-mode') == '允许';
}

function setAllowTeamModeByCode(allow) {
  setTabVal('team-mode', allow ? '允许' : '不允许');
}

function refreshCustomTeamTabs(allowTeam) {
  var tabs = $('#tabs-custom-team')[0];
  if (!tabs) return;

  var firstPlayerTab = tabs.children[1];
  $(firstPlayerTab).html(allowTeam ? '1' : '参赛');
  for (var i = 2; i <= max_teams; i++) {
    $(tabs.children[i]).css('display', allowTeam ? '' : 'none');
  }
}

function setTabGroupReadonly(tabId, readonly) {
  var tabs = $('#' + tabId)[0];
  if (!tabs) return;
  if (readonly) $(tabs).attr('data-readonly', '1');
  else $(tabs).removeAttr('data-readonly');
  var key = tabId.substr(5);
  setTabVal(key, getTabVal(key));
}

function updateConfPatch(patch) {
  if (!patch) return;
  if (Object.keys(patch).length === 0) return;
  socket.emit('change_game_conf', patch);
}

const delayUpdateMapToken = _.debounce(function () {
  var value = normalizeMapTokenInput($('#map-token').val());
  if ($('#map-token').val() != value) {
    $('#map-token').val(value);
  }
  updateConfPatch({ map_token: value.trim() });
}, 300);

function updateTeam() {
  var team = getTabVal('custom-team');
  if (team == '观战') team = 0;
  else if (team == '参赛') team = 1;
  else team = parseInt(team);
  if (isNaN(team)) return;
  socket.emit('change_team', { team: team });
}

function getTabVal(x) {
  return $($('#tabs-' + x)[0].children[0]).val();
}

function setTabVal(x, y) {
  var tabGroup = $('#tabs-' + x)[0];
  if (!tabGroup) return;
  var tabs = tabGroup.children;
  var readonly = $(tabGroup).attr('data-readonly') == '1';
  for (var i = 1; i < tabs.length; i++) {
    var active = $(tabs[i]).html() == y;
    var cls = active ? 'inline-button inverted' : 'inline-button';
    if (readonly) cls += ' readonly';
    $(tabs[i]).attr('class', cls);
  }
  $(tabs[0]).val(y);
}

function initTab(x, y, callback) {
  $(y).on('click', function () {
    var groupKey = $(x).attr('id').substr(5);
    var nextVal = $(y).html();
    if (getTabVal(groupKey) == nextVal) return;
    setTabVal(groupKey, nextVal);
    callback();
  });
}

var chatStr = '';
var teamPrefix = '[队伍] ';

function checkChat() {
  var tmp = $('#chatroom-input').val(),
    res;
  if (is_team) {
    if (tmp.substr(0, teamPrefix.length) == teamPrefix) {
      res = tmp.substr(teamPrefix.length);
    } else {
      res = chatStr;
    }
  } else {
    if (tmp.substr(0, teamPrefix.length) == teamPrefix) {
      res = tmp.substr(teamPrefix.length);
    } else {
      res = tmp;
    }
  }
  chatStr = res;
  $('#chatroom-input').val((is_team ? teamPrefix : '') + res);
}
