/**
 * Commands that do not wake the display.
 *
 * Polling and read-only calls would otherwise keep the panel awake forever.
 * Every command in ``commands/index.js`` must appear in exactly one of the
 * two sets; the classification test fails when a new command is added
 * without a deliberate choice.
 */
const PASSIVE_COMMANDS = new Set([
  'playerstatus',
  'getVolume',
  'getMaxVolume',
  'getAudioOutputs',
  'getAutohotspotStatus',
  'getIpAddress',
  'getDiskUsage',
  'getAppSettings',
  'getSingleCoverArt',
  'getAlbumCoverArt',
  'getSongByUrl',
  'directoryTreeOfAudiofolder',
  'albumList',
  'librarySources',
  'libraryItems',
  'songList',
  'folderList',
  'cardsList',
  'timer_fade_volume.get_state',
  'timer_shutdown.get_state',
  'timer_stop_player.get_state',
  'timer_idle_shutdown.get_state',
  'getJellyfinSettings',
  'mcp23017Settings',
  'mcp23017LearnState',
]);

/**
 * Commands that count as a user interaction.
 *
 * The display commands are interactive as well, but the request wrapper
 * skips the activity ping for the ``display`` package so that a status
 * refresh cannot wake the panel by itself.
 */
const INTERACTIVE_COMMANDS = new Set([
  'registerCard',
  'deleteCard',
  'play',
  'play_single',
  'play_folder',
  'play_album',
  'pause',
  'prev_song',
  'next_song',
  'toggle',
  'shuffle',
  'repeat',
  'seek',
  'setVolume',
  'setMaxVolume',
  'change_volume',
  'toggleMuteVolume',
  'setAudioOutput',
  'toggle_output',
  'timer_fade_volume.cancel',
  'timer_fade_volume',
  'timer_shutdown.cancel',
  'timer_shutdown',
  'timer_stop_player.cancel',
  'timer_stop_player',
  'timer_idle_shutdown.cancel',
  'timer_idle_shutdown',
  'startAutohotspot',
  'stopAutohotspot',
  'reboot',
  'shutdown',
  'say_my_ip',
  'setAppSettings',
  'setJellyfinSettings',
  'testJellyfinConnection',
  'mcp23017SetButton',
  'mcp23017ClearButton',
  'mcp23017StartLearn',
  'mcp23017CancelLearn',
  'displayStatus',
  'displaySetBrightness',
  'displaySetDimBrightness',
  'displaySetTimeouts',
  'displaySetMusicMode',
  'displaySetStandbyMechanic',
  'displaySetPower',
  'sync_rfidcards_all',
  'sync_rfidcards_change_on_rfid_scan',
]);

export {
  INTERACTIVE_COMMANDS,
  PASSIVE_COMMANDS,
};
