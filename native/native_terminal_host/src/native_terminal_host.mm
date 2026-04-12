#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>

#include <node_api.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

#include "ghostty.h"

@class BGGhosttyHost;
@class BGTerminalTabHostView;
@class BGTerminalSplitView;

static napi_value MakeBoolean(napi_env env, bool value) {
  napi_value result = nullptr;
  napi_get_boolean(env, value, &result);
  return result;
}

static napi_value MakeUndefined(napi_env env) {
  napi_value result = nullptr;
  napi_get_undefined(env, &result);
  return result;
}

static void ThrowTypeError(napi_env env, const char *message) {
  napi_throw_type_error(env, nullptr, message);
}

static void ThrowError(napi_env env, const char *message) {
  napi_throw_error(env, nullptr, message);
}

static bool GetStringArg(napi_env env, napi_value value, NSString **out) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) {
    return false;
  }

  std::string buffer(length + 1, '\0');
  if (napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &length) != napi_ok) {
    return false;
  }

  *out = [[NSString alloc] initWithUTF8String:buffer.c_str()];
  return *out != nil;
}

static bool GetBoolArg(napi_env env, napi_value value, bool *out) {
  return napi_get_value_bool(env, value, out) == napi_ok;
}

static bool GetNumberProperty(napi_env env, napi_value object, const char *key, double *out) {
  napi_value prop = nullptr;
  if (napi_get_named_property(env, object, key, &prop) != napi_ok) {
    return false;
  }
  return napi_get_value_double(env, prop, out) == napi_ok;
}

static ghostty_input_mods_e GhosttyModsFromFlags(NSEventModifierFlags flags) {
  uint32_t mods = GHOSTTY_MODS_NONE;
  if ((flags & NSEventModifierFlagShift) != 0) mods |= GHOSTTY_MODS_SHIFT;
  if ((flags & NSEventModifierFlagControl) != 0) mods |= GHOSTTY_MODS_CTRL;
  if ((flags & NSEventModifierFlagOption) != 0) mods |= GHOSTTY_MODS_ALT;
  if ((flags & NSEventModifierFlagCommand) != 0) mods |= GHOSTTY_MODS_SUPER;
  if ((flags & NSEventModifierFlagCapsLock) != 0) mods |= GHOSTTY_MODS_CAPS;

  const NSUInteger rawFlags = flags;
  if ((rawFlags & NX_DEVICERSHIFTKEYMASK) != 0) mods |= GHOSTTY_MODS_SHIFT_RIGHT;
  if ((rawFlags & NX_DEVICERCTLKEYMASK) != 0) mods |= GHOSTTY_MODS_CTRL_RIGHT;
  if ((rawFlags & NX_DEVICERALTKEYMASK) != 0) mods |= GHOSTTY_MODS_ALT_RIGHT;
  if ((rawFlags & NX_DEVICERCMDKEYMASK) != 0) mods |= GHOSTTY_MODS_SUPER_RIGHT;

  return static_cast<ghostty_input_mods_e>(mods);
}

static NSEventModifierFlags EventFlagsFromGhosttyMods(ghostty_input_mods_e mods) {
  NSEventModifierFlags flags = 0;
  if ((mods & GHOSTTY_MODS_SHIFT) != 0) flags |= NSEventModifierFlagShift;
  if ((mods & GHOSTTY_MODS_CTRL) != 0) flags |= NSEventModifierFlagControl;
  if ((mods & GHOSTTY_MODS_ALT) != 0) flags |= NSEventModifierFlagOption;
  if ((mods & GHOSTTY_MODS_SUPER) != 0) flags |= NSEventModifierFlagCommand;
  return flags;
}

static std::string GhosttyCharactersForEvent(NSEvent *event) {
  NSString *characters = event.characters;
  if (characters == nil || characters.length == 0) {
    return {};
  }

  if (characters.length == 1) {
    const unichar scalar = [characters characterAtIndex:0];
    if (scalar < 0x20) {
      NSString *translated =
          [event charactersByApplyingModifiers:(event.modifierFlags & ~NSEventModifierFlagControl)];
      if (translated != nil) {
        return std::string(translated.UTF8String ?: "");
      }
    }

    if (scalar >= 0xF700 && scalar <= 0xF8FF) {
      return {};
    }
  }

  return std::string(characters.UTF8String ?: "");
}

static ghostty_input_key_s GhosttyKeyEventForEvent(
    NSEvent *event,
    ghostty_input_action_e action,
    NSEventModifierFlags translationFlags) {
  ghostty_input_key_s keyEvent{};
  keyEvent.action = action;
  keyEvent.mods = GhosttyModsFromFlags(event.modifierFlags);
  keyEvent.consumed_mods =
      GhosttyModsFromFlags(translationFlags & ~(NSEventModifierFlagControl | NSEventModifierFlagCommand));
  keyEvent.keycode = static_cast<uint32_t>(event.keyCode);
  keyEvent.text = nullptr;
  keyEvent.composing = false;
  keyEvent.unshifted_codepoint = 0;

  if (event.type == NSEventTypeKeyDown || event.type == NSEventTypeKeyUp) {
    NSString *unshifted = [event charactersByApplyingModifiers:0];
    if (unshifted != nil && unshifted.length > 0) {
      keyEvent.unshifted_codepoint = [unshifted characterAtIndex:0];
    }
  }

  return keyEvent;
}

static NSCursor *CursorForShape(ghostty_action_mouse_shape_e shape) {
  switch (shape) {
    case GHOSTTY_MOUSE_SHAPE_TEXT:
      return [NSCursor IBeamCursor];
    case GHOSTTY_MOUSE_SHAPE_POINTER:
      return [NSCursor pointingHandCursor];
    case GHOSTTY_MOUSE_SHAPE_CROSSHAIR:
      return [NSCursor crosshairCursor];
    case GHOSTTY_MOUSE_SHAPE_CONTEXT_MENU:
      return [NSCursor contextualMenuCursor];
    case GHOSTTY_MOUSE_SHAPE_NOT_ALLOWED:
      return [NSCursor operationNotAllowedCursor];
    default:
      return [NSCursor arrowCursor];
  }
}

static NSColor *ColorFromHexString(NSString *hexString) {
  if (hexString == nil) {
    return nil;
  }

  NSString *normalized = [[hexString stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]
      uppercaseString];
  if ([normalized hasPrefix:@"#"]) {
    normalized = [normalized substringFromIndex:1];
  }

  if (normalized.length != 6 && normalized.length != 8) {
    return nil;
  }

  unsigned int hexValue = 0;
  NSScanner *scanner = [NSScanner scannerWithString:normalized];
  if (![scanner scanHexInt:&hexValue]) {
    return nil;
  }

  if (normalized.length == 6) {
    return [NSColor colorWithRed:((hexValue >> 16) & 0xFF) / 255.0
                           green:((hexValue >> 8) & 0xFF) / 255.0
                            blue:(hexValue & 0xFF) / 255.0
                           alpha:1.0];
  }

  return [NSColor colorWithRed:((hexValue >> 24) & 0xFF) / 255.0
                         green:((hexValue >> 16) & 0xFF) / 255.0
                          blue:((hexValue >> 8) & 0xFF) / 255.0
                         alpha:(hexValue & 0xFF) / 255.0];
}

static NSString *HexStringFromGhosttyColor(ghostty_config_color_s color) {
  return [NSString stringWithFormat:@"#%02X%02X%02X", color.r, color.g, color.b];
}

static NSString *EmbeddedGhosttyOverridePath() {
  static NSString *overridePath = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    NSString *tempDir = NSTemporaryDirectory();
    overridePath = [tempDir stringByAppendingPathComponent:@"bettergit-ghostty-embedded.conf"];
    NSString *contents =
        @"background-opacity = 0\n"
         "background-opacity-cells = true\n"
         "background-blur = false\n"
         "scrollback-limit = 2000000\n"
         "keybind = super+d=unbind\n"
         "keybind = super+shift+d=unbind\n";
    NSError *error = nil;
    [contents writeToFile:overridePath atomically:YES encoding:NSUTF8StringEncoding error:&error];
    (void)error;
  });
  return overridePath;
}

static NSString *BackgroundOverridePath(NSString *hexColor) {
  NSString *tempDir = NSTemporaryDirectory();
  NSString *overridePath = [tempDir stringByAppendingPathComponent:@"bettergit-ghostty-background.conf"];
  NSString *sanitizedColor = hexColor.length > 0 ? hexColor : @"#34353d";
  NSString *contents = [NSString stringWithFormat:
      @"background = %@\nbackground-opacity = 0\nbackground-opacity-cells = true\nbackground-blur = false\n",
      sanitizedColor];
  NSError *error = nil;
  [contents writeToFile:overridePath atomically:YES encoding:NSUTF8StringEncoding error:&error];
  (void)error;
  return overridePath;
}

@interface BGGhosttySurfaceView : NSView
@property(nonatomic, assign) ghostty_surface_t surface;
@property(nonatomic, weak) BGGhosttyHost *host;
@property(nonatomic, copy) NSString *surfaceId;
@property(nonatomic, copy) NSString *titleText;
@property(nonatomic, copy) NSString *workingDirectory;
@property(nonatomic, strong) NSTrackingArea *trackingArea;
@property(nonatomic, strong) NSCursor *cursorShape;
@property(nonatomic, assign) BOOL cursorVisible;
- (instancetype)initWithHost:(BGGhosttyHost *)host surfaceId:(NSString *)surfaceId cwd:(NSString *)cwd;
- (instancetype)initWithHost:(BGGhosttyHost *)host
                   surfaceId:(NSString *)surfaceId
                      config:(const ghostty_surface_config_s *)config;
- (void)updateGhosttySize;
- (void)setGhosttyFocused:(BOOL)focused;
- (void)performSurfaceText:(NSString *)text;
- (BOOL)performBindingAction:(const char *)actionName;
@end

@interface BGTerminalPaneView : NSView
@property(nonatomic, weak) BGTerminalTabHostView *tabHost;
@property(nonatomic, weak) BGTerminalSplitView *splitParent;
@end

@interface BGTerminalSurfaceContainerView : BGTerminalPaneView
@property(nonatomic, strong) BGGhosttySurfaceView *surfaceView;
- (instancetype)initWithSurfaceView:(BGGhosttySurfaceView *)surfaceView;
- (void)setBackgroundHexColor:(NSString *)hexColor;
@end

@interface BGTerminalSplitView : BGTerminalPaneView
@property(nonatomic, strong) BGTerminalPaneView *firstPane;
@property(nonatomic, strong) BGTerminalPaneView *secondPane;
@property(nonatomic, assign) ghostty_action_split_direction_e direction;
- (instancetype)initWithFirstPane:(BGTerminalPaneView *)firstPane
                       secondPane:(BGTerminalPaneView *)secondPane
                        direction:(ghostty_action_split_direction_e)direction;
- (BGTerminalPaneView *)siblingPaneForPane:(BGTerminalPaneView *)pane;
- (void)replaceChildPane:(BGTerminalPaneView *)existing withPane:(BGTerminalPaneView *)replacement;
@end

@interface BGTerminalTabHostView : NSView
@property(nonatomic, weak) BGGhosttyHost *host;
@property(nonatomic, copy) NSString *surfaceId;
@property(nonatomic, strong) BGTerminalPaneView *rootPane;
@property(nonatomic, strong) BGGhosttySurfaceView *activeSurfaceView;
@property(nonatomic, copy) NSString *backgroundHexColor;
- (instancetype)initWithHost:(BGGhosttyHost *)host surfaceId:(NSString *)surfaceId rootPane:(BGTerminalPaneView *)rootPane;
- (void)setRootPane:(BGTerminalPaneView *)rootPane;
- (void)noteFocusedSurfaceView:(BGGhosttySurfaceView *)surfaceView;
- (BGGhosttySurfaceView *)focusedSurfaceView;
- (void)applyBackgroundHexColor:(NSString *)hexColor;
- (void)applyVisibility:(BOOL)visible;
- (void)updateSurfaceSizes;
- (void)splitSurfaceView:(BGGhosttySurfaceView *)sourceSurface direction:(ghostty_action_split_direction_e)direction;
- (void)closeSurfaceView:(BGGhosttySurfaceView *)surfaceView;
@end

@interface BGGhosttyHost : NSObject
@property(nonatomic, assign) ghostty_app_t app;
@property(nonatomic, assign) ghostty_config_t config;
@property(nonatomic, weak) NSView *rootView;
@property(nonatomic, strong) NSMutableDictionary<NSString *, BGTerminalTabHostView *> *tabs;
@property(nonatomic, assign) BOOL tickScheduled;
- (instancetype)initWithRootView:(NSView *)rootView;
- (BOOL)matchesRootView:(NSView *)rootView;
- (void)shutdown;
- (BOOL)createSurfaceWithId:(NSString *)surfaceId cwd:(NSString *)cwd;
- (void)destroySurfaceWithId:(NSString *)surfaceId;
- (BOOL)closeFocusedSurfaceWithId:(NSString *)surfaceId;
- (void)setSurfaceFrame:(NSRect)frame forSurfaceId:(NSString *)surfaceId;
- (void)setSurfaceBackgroundHexColor:(NSString *)hexColor forSurfaceId:(NSString *)surfaceId;
- (void)setSurfaceVisible:(BOOL)visible forSurfaceId:(NSString *)surfaceId;
- (void)focusSurfaceWithId:(NSString *)surfaceId;
- (void)splitSurfaceWithId:(NSString *)surfaceId direction:(ghostty_action_split_direction_e)direction;
- (void)setAppFocused:(BOOL)focused;
- (void)scheduleTick;
- (BOOL)handleAction:(ghostty_action_s)action target:(ghostty_target_s)target;
- (void)noteFocusedSurfaceView:(BGGhosttySurfaceView *)surfaceView;
- (void)closeSurfaceView:(BGGhosttySurfaceView *)surfaceView;
- (void)completeClipboardRequestForSurface:(BGGhosttySurfaceView *)surface
                                      text:(NSString *)text
                                     state:(void *)state
                                 confirmed:(BOOL)confirmed;
- (BGGhosttySurfaceView *)surfaceForTarget:(ghostty_target_s)target;
- (BGTerminalTabHostView *)tabHostForSurfaceView:(BGGhosttySurfaceView *)surfaceView;
- (NSDictionary<NSString *, id> *)resolvedAppearance;
@end

static BGGhosttyHost *gHost = nil;
static bool gGhosttyInitialized = false;
static std::vector<char *> gGhosttyArgv;

static bool EnsureGhosttyInitialized() {
  if (gGhosttyInitialized) {
    return true;
  }

  NSArray<NSString *> *arguments = NSProcessInfo.processInfo.arguments;
  gGhosttyArgv.clear();
  gGhosttyArgv.reserve(arguments.count);

  for (NSString *argument in arguments) {
    const char *utf8 = argument.UTF8String;
    gGhosttyArgv.push_back(strdup(utf8 != nullptr ? utf8 : ""));
  }

  if (ghostty_init(gGhosttyArgv.size(), gGhosttyArgv.data()) != GHOSTTY_SUCCESS) {
    return false;
  }

  gGhosttyInitialized = true;
  return true;
}

static void HostWakeup(void *userdata) {
  BGGhosttyHost *host = (__bridge BGGhosttyHost *)userdata;
  [host scheduleTick];
}

static bool HostReadClipboard(void *userdata, ghostty_clipboard_e location, void *state) {
  (void)location;
  BGGhosttySurfaceView *surfaceView = (__bridge BGGhosttySurfaceView *)userdata;
  NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
  NSString *text = [pasteboard stringForType:NSPasteboardTypeString];
  if (text == nil || text.length == 0) {
    return false;
  }

  [surfaceView.host completeClipboardRequestForSurface:surfaceView text:text state:state confirmed:NO];
  return true;
}

static void HostConfirmReadClipboard(
    void *userdata,
    const char *string,
    void *state,
    ghostty_clipboard_request_e request) {
  (void)request;
  BGGhosttySurfaceView *surfaceView = (__bridge BGGhosttySurfaceView *)userdata;
  if (string == nullptr) {
    return;
  }

  NSString *text = [NSString stringWithUTF8String:string];
  if (text == nil) {
    return;
  }

  [surfaceView.host completeClipboardRequestForSurface:surfaceView text:text state:state confirmed:YES];
}

static void HostWriteClipboard(
    void *userdata,
    ghostty_clipboard_e location,
    const ghostty_clipboard_content_s *content,
    size_t len,
    bool confirm) {
  (void)userdata;
  (void)location;
  (void)confirm;
  if (content == nullptr || len == 0) {
    return;
  }

  NSString *plainText = nil;
  for (size_t i = 0; i < len; ++i) {
    const ghostty_clipboard_content_s item = content[i];
    if (item.data == nullptr) {
      continue;
    }

    NSString *mime = item.mime != nullptr ? [NSString stringWithUTF8String:item.mime] : nil;
    if (mime == nil || [mime hasPrefix:@"text/plain"]) {
      plainText = [NSString stringWithUTF8String:item.data];
      break;
    }
  }

  if (plainText == nil) {
    return;
  }

  NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
  [pasteboard clearContents];
  [pasteboard setString:plainText forType:NSPasteboardTypeString];
}

static void HostCloseSurface(void *userdata, bool processAlive) {
  (void)processAlive;
  BGGhosttySurfaceView *surfaceView = (__bridge BGGhosttySurfaceView *)userdata;
  [surfaceView.host closeSurfaceView:surfaceView];
}

static bool HostAction(ghostty_app_t app, ghostty_target_s target, ghostty_action_s action) {
  BGGhosttyHost *host = (__bridge BGGhosttyHost *)ghostty_app_userdata(app);
  return [host handleAction:action target:target];
}

@implementation BGTerminalPaneView
@end

@implementation BGGhosttySurfaceView

- (instancetype)initWithHost:(BGGhosttyHost *)host surfaceId:(NSString *)surfaceId cwd:(NSString *)cwd {
  ghostty_surface_config_s config = ghostty_surface_config_new();
  config.working_directory = cwd.UTF8String;
  config.context = GHOSTTY_SURFACE_CONTEXT_WINDOW;
  return [self initWithHost:host surfaceId:surfaceId config:&config];
}

- (instancetype)initWithHost:(BGGhosttyHost *)host
                   surfaceId:(NSString *)surfaceId
                      config:(const ghostty_surface_config_s *)config {
  self = [super initWithFrame:NSMakeRect(0, 0, 800, 600)];
  if (self == nil) {
    return nil;
  }

  _host = host;
  _surfaceId = [surfaceId copy];
  _titleText = @"";
  _cursorVisible = YES;
  _cursorShape = [NSCursor IBeamCursor];

  ghostty_surface_config_s surfaceConfig =
      config != nullptr ? *config : ghostty_surface_config_new();
  surfaceConfig.platform_tag = GHOSTTY_PLATFORM_MACOS;
  surfaceConfig.platform.macos.nsview = (__bridge void *)self;
  surfaceConfig.userdata = (__bridge void *)self;
  surfaceConfig.scale_factor =
      self.window.screen.backingScaleFactor ?: NSScreen.mainScreen.backingScaleFactor ?: 1.0;

  if (surfaceConfig.working_directory != nullptr) {
    _workingDirectory = [[NSString alloc] initWithUTF8String:surfaceConfig.working_directory];
  } else {
    _workingDirectory = @"";
  }

  _surface = ghostty_surface_new(host.app, &surfaceConfig);
  if (_surface != nullptr) {
    [self updateGhosttySize];
  }

  return self;
}

- (void)dealloc {
  if (_trackingArea != nil) {
    [self removeTrackingArea:_trackingArea];
  }
  if (_surface != nullptr) {
    ghostty_surface_free(_surface);
    _surface = nullptr;
  }
}

- (BOOL)acceptsFirstResponder {
  return YES;
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  (void)event;
  return YES;
}

- (BOOL)becomeFirstResponder {
  [self setGhosttyFocused:YES];
  [self.host noteFocusedSurfaceView:self];
  return YES;
}

- (BOOL)resignFirstResponder {
  [self setGhosttyFocused:NO];
  return YES;
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  [self updateGhosttySize];
}

- (void)viewDidChangeBackingProperties {
  [super viewDidChangeBackingProperties];
  [self updateGhosttySize];
}

- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (_trackingArea != nil) {
    [self removeTrackingArea:_trackingArea];
  }

  _trackingArea = [[NSTrackingArea alloc]
      initWithRect:self.bounds
           options:NSTrackingMouseEnteredAndExited | NSTrackingMouseMoved |
                   NSTrackingActiveInActiveApp | NSTrackingInVisibleRect
             owner:self
          userInfo:nil];
  [self addTrackingArea:_trackingArea];
}

- (void)resetCursorRects {
  [self discardCursorRects];
  if (_cursorVisible) {
    [self addCursorRect:self.bounds cursor:_cursorShape ?: [NSCursor IBeamCursor]];
  }
}

- (void)drawRect:(NSRect)dirtyRect {
  [super drawRect:dirtyRect];
  if (_surface != nullptr) {
    ghostty_surface_draw(_surface);
  }
}

- (void)updateGhosttySize {
  if (_surface == nullptr || self.bounds.size.width <= 0 || self.bounds.size.height <= 0) {
    return;
  }

  const CGFloat xScale = self.window.backingScaleFactor ?: NSScreen.mainScreen.backingScaleFactor ?: 1.0;
  ghostty_surface_set_content_scale(_surface, xScale, xScale);

  const NSSize backingSize = [self convertSizeToBacking:self.bounds.size];
  const uint32_t width = static_cast<uint32_t>(std::max(1.0, std::round(backingSize.width)));
  const uint32_t height = static_cast<uint32_t>(std::max(1.0, std::round(backingSize.height)));
  ghostty_surface_set_size(_surface, width, height);
  [self setNeedsDisplay:YES];
}

- (void)setGhosttyFocused:(BOOL)focused {
  if (_surface == nullptr) {
    return;
  }
  ghostty_surface_set_focus(_surface, focused);
}

- (void)performSurfaceText:(NSString *)text {
  if (_surface == nullptr || text.length == 0) {
    return;
  }

  const char *utf8 = text.UTF8String;
  if (utf8 == nullptr) {
    return;
  }

  ghostty_surface_text(_surface, utf8, std::strlen(utf8));
}

- (BOOL)performBindingAction:(const char *)actionName {
  if (_surface == nullptr || actionName == nullptr) {
    return NO;
  }

  return ghostty_surface_binding_action(_surface, actionName, std::strlen(actionName));
}

- (IBAction)copy:(id)sender {
  (void)sender;
  [self performBindingAction:"copy_to_clipboard"];
}

- (IBAction)paste:(id)sender {
  (void)sender;
  [self performBindingAction:"paste_from_clipboard"];
}

- (IBAction)pasteAsPlainText:(id)sender {
  (void)sender;
  [self performBindingAction:"paste_from_clipboard"];
}

- (IBAction)selectAll:(id)sender {
  (void)sender;
  [self performBindingAction:"select_all"];
}

- (void)mouseDown:(NSEvent *)event {
  if (_surface == nullptr) {
    return;
  }
  [[self window] makeFirstResponder:self];
  ghostty_surface_mouse_button(_surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_LEFT,
                               GhosttyModsFromFlags(event.modifierFlags));
}

- (void)mouseUp:(NSEvent *)event {
  if (_surface == nullptr) {
    return;
  }
  ghostty_surface_mouse_button(_surface, GHOSTTY_MOUSE_RELEASE, GHOSTTY_MOUSE_LEFT,
                               GhosttyModsFromFlags(event.modifierFlags));
}

- (void)rightMouseDown:(NSEvent *)event {
  if (_surface == nullptr) {
    return;
  }
  [[self window] makeFirstResponder:self];
  ghostty_surface_mouse_button(_surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_RIGHT,
                               GhosttyModsFromFlags(event.modifierFlags));
}

- (void)rightMouseUp:(NSEvent *)event {
  if (_surface == nullptr) {
    return;
  }
  ghostty_surface_mouse_button(_surface, GHOSTTY_MOUSE_RELEASE, GHOSTTY_MOUSE_RIGHT,
                               GhosttyModsFromFlags(event.modifierFlags));
}

- (void)mouseMoved:(NSEvent *)event {
  if (_surface == nullptr) {
    return;
  }
  const NSPoint location = [self convertPoint:event.locationInWindow fromView:nil];
  ghostty_surface_mouse_pos(_surface, location.x, self.bounds.size.height - location.y,
                            GhosttyModsFromFlags(event.modifierFlags));
}

- (void)mouseDragged:(NSEvent *)event {
  [self mouseMoved:event];
}

- (void)rightMouseDragged:(NSEvent *)event {
  [self mouseMoved:event];
}

- (void)scrollWheel:(NSEvent *)event {
  if (_surface == nullptr) {
    return;
  }

  double x = event.scrollingDeltaX;
  double y = event.scrollingDeltaY;
  if (event.hasPreciseScrollingDeltas) {
    x *= 2.0;
    y *= 2.0;
  }

  ghostty_surface_mouse_scroll(_surface, x, y, 0);
}

- (void)keyDown:(NSEvent *)event {
  if (_surface == nullptr) {
    return;
  }

  ghostty_input_mods_e translatedMods =
      ghostty_surface_key_translation_mods(_surface, GhosttyModsFromFlags(event.modifierFlags));
  NSEventModifierFlags translationFlags = event.modifierFlags;
  const NSEventModifierFlags translatedFlags = EventFlagsFromGhosttyMods(translatedMods);

  const NSEventModifierFlags flagsToSync[] = {
    NSEventModifierFlagShift,
    NSEventModifierFlagControl,
    NSEventModifierFlagOption,
    NSEventModifierFlagCommand,
  };
  for (NSEventModifierFlags flag : flagsToSync) {
    if ((translatedFlags & flag) != 0) {
      translationFlags |= flag;
    } else {
      translationFlags &= ~flag;
    }
  }

  const ghostty_input_action_e action = event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS;
  ghostty_input_key_s keyEvent = GhosttyKeyEventForEvent(event, action, translationFlags);
  const std::string text = GhosttyCharactersForEvent(event);
  if (!text.empty()) {
    keyEvent.text = text.c_str();
  }

  ghostty_surface_key(_surface, keyEvent);
}

- (void)keyUp:(NSEvent *)event {
  if (_surface == nullptr) {
    return;
  }

  ghostty_input_key_s keyEvent = GhosttyKeyEventForEvent(event, GHOSTTY_ACTION_RELEASE, event.modifierFlags);
  ghostty_surface_key(_surface, keyEvent);
}

- (void)flagsChanged:(NSEvent *)event {
  (void)event;
  // Modifier-only NSEvent bridging is the unstable part of the embedded host.
  // Regular key events already carry the full modifier state Ghostty needs,
  // and edit commands like copy/paste are handled via AppKit responder actions.
  // Avoid forwarding raw flagsChanged events until the full NSTextInputClient
  // path is implemented.
}

@end

@implementation BGTerminalSurfaceContainerView

- (instancetype)initWithSurfaceView:(BGGhosttySurfaceView *)surfaceView {
  self = [super initWithFrame:surfaceView.frame];
  if (self == nil) {
    return nil;
  }

  _surfaceView = surfaceView;
  self.wantsLayer = YES;
  self.layer.backgroundColor = NSColor.clearColor.CGColor;
  [self addSubview:surfaceView];
  return self;
}

- (void)layout {
  [super layout];
  self.surfaceView.frame = self.bounds;
}

- (void)setBackgroundHexColor:(NSString *)hexColor {
  NSColor *backgroundColor = ColorFromHexString(hexColor);
  self.layer.backgroundColor = (backgroundColor ?: NSColor.clearColor).CGColor;
}

@end

@implementation BGTerminalSplitView

- (instancetype)initWithFirstPane:(BGTerminalPaneView *)firstPane
                       secondPane:(BGTerminalPaneView *)secondPane
                        direction:(ghostty_action_split_direction_e)direction {
  self = [super initWithFrame:NSMakeRect(0, 0, 800, 600)];
  if (self == nil) {
    return nil;
  }

  _direction = direction;
  self.wantsLayer = YES;
  self.layer.backgroundColor = NSColor.clearColor.CGColor;

  _firstPane = firstPane;
  _secondPane = secondPane;
  _firstPane.splitParent = self;
  _secondPane.splitParent = self;
  [self addSubview:_firstPane];
  [self addSubview:_secondPane];
  return self;
}

- (BOOL)isHorizontalSplit {
  return _direction == GHOSTTY_SPLIT_DIRECTION_LEFT || _direction == GHOSTTY_SPLIT_DIRECTION_RIGHT;
}

- (void)layout {
  [super layout];

  const CGFloat divider = 1.0;
  NSRect bounds = self.bounds;
  if ([self isHorizontalSplit]) {
    CGFloat paneWidth = floor((bounds.size.width - divider) / 2.0);
    self.firstPane.frame = NSMakeRect(0, 0, paneWidth, bounds.size.height);
    self.secondPane.frame = NSMakeRect(
        paneWidth + divider,
        0,
        std::max<CGFloat>(0, bounds.size.width - paneWidth - divider),
        bounds.size.height);
  } else {
    CGFloat paneHeight = floor((bounds.size.height - divider) / 2.0);
    self.firstPane.frame = NSMakeRect(0, 0, bounds.size.width, paneHeight);
    self.secondPane.frame = NSMakeRect(
        0,
        paneHeight + divider,
        bounds.size.width,
        std::max<CGFloat>(0, bounds.size.height - paneHeight - divider));
  }
}

- (BGTerminalPaneView *)siblingPaneForPane:(BGTerminalPaneView *)pane {
  if (pane == _firstPane) return _secondPane;
  if (pane == _secondPane) return _firstPane;
  return nil;
}

- (void)replaceChildPane:(BGTerminalPaneView *)existing withPane:(BGTerminalPaneView *)replacement {
  if (existing == nil || replacement == nil) return;

  replacement.tabHost = self.tabHost;
  replacement.splitParent = self;
  [self addSubview:replacement];

  if (existing == _firstPane) {
    if (_firstPane.superview == self) {
      [_firstPane removeFromSuperview];
    }
    _firstPane = replacement;
  } else if (existing == _secondPane) {
    if (_secondPane.superview == self) {
      [_secondPane removeFromSuperview];
    }
    _secondPane = replacement;
  } else {
    [replacement removeFromSuperview];
    return;
  }

  [self setNeedsLayout:YES];
}

@end

@implementation BGTerminalTabHostView

- (instancetype)initWithHost:(BGGhosttyHost *)host surfaceId:(NSString *)surfaceId rootPane:(BGTerminalPaneView *)rootPane {
  self = [super initWithFrame:NSMakeRect(0, 0, 800, 600)];
  if (self == nil) {
    return nil;
  }

  _host = host;
  _surfaceId = [surfaceId copy];
  _backgroundHexColor = @"#34353d";
  self.wantsLayer = YES;
  self.layer.backgroundColor = NSColor.clearColor.CGColor;
  [self setRootPane:rootPane];
  return self;
}

- (void)setRootPane:(BGTerminalPaneView *)rootPane {
  if (_rootPane == rootPane) return;
  if (_rootPane.superview == self) {
    [_rootPane removeFromSuperview];
  }
  _rootPane = rootPane;
  _rootPane.tabHost = self;
  _rootPane.splitParent = nil;
  if (_rootPane != nil) {
    [self addSubview:_rootPane];
    _rootPane.frame = self.bounds;
  }
  [self setNeedsLayout:YES];
}

- (void)layout {
  [super layout];
  self.rootPane.frame = self.bounds;
}

- (void)noteFocusedSurfaceView:(BGGhosttySurfaceView *)surfaceView {
  _activeSurfaceView = surfaceView;
}

- (BGGhosttySurfaceView *)focusedSurfaceView {
  if (_activeSurfaceView != nil) return _activeSurfaceView;
  return [self firstSurfaceViewInPane:self.rootPane];
}

- (BGGhosttySurfaceView *)firstSurfaceViewInPane:(BGTerminalPaneView *)pane {
  if ([pane isKindOfClass:[BGTerminalSurfaceContainerView class]]) {
    return ((BGTerminalSurfaceContainerView *)pane).surfaceView;
  }

  if ([pane isKindOfClass:[BGTerminalSplitView class]]) {
    BGTerminalSplitView *split = (BGTerminalSplitView *)pane;
    BGGhosttySurfaceView *first = [self firstSurfaceViewInPane:split.firstPane];
    if (first != nil) return first;
    return [self firstSurfaceViewInPane:split.secondPane];
  }

  return nil;
}

- (void)applyBackgroundHexColor:(NSString *)hexColor {
  _backgroundHexColor = [hexColor copy];
  [self applyBackgroundHexColor:hexColor toPane:self.rootPane];
}

- (void)applyBackgroundHexColor:(NSString *)hexColor toPane:(BGTerminalPaneView *)pane {
  if ([pane isKindOfClass:[BGTerminalSurfaceContainerView class]]) {
    [((BGTerminalSurfaceContainerView *)pane) setBackgroundHexColor:hexColor];
    return;
  }

  if ([pane isKindOfClass:[BGTerminalSplitView class]]) {
    BGTerminalSplitView *split = (BGTerminalSplitView *)pane;
    [self applyBackgroundHexColor:hexColor toPane:split.firstPane];
    [self applyBackgroundHexColor:hexColor toPane:split.secondPane];
  }
}

- (void)applyVisibility:(BOOL)visible {
  self.hidden = !visible;
  [self applyVisibility:visible toPane:self.rootPane];
}

- (void)applyVisibility:(BOOL)visible toPane:(BGTerminalPaneView *)pane {
  if ([pane isKindOfClass:[BGTerminalSurfaceContainerView class]]) {
    BGGhosttySurfaceView *surfaceView = ((BGTerminalSurfaceContainerView *)pane).surfaceView;
    if (surfaceView.surface != nullptr) {
      ghostty_surface_set_occlusion(surfaceView.surface, visible);
    }
    if (visible) {
      [surfaceView updateGhosttySize];
    }
    return;
  }

  if ([pane isKindOfClass:[BGTerminalSplitView class]]) {
    BGTerminalSplitView *split = (BGTerminalSplitView *)pane;
    [self applyVisibility:visible toPane:split.firstPane];
    [self applyVisibility:visible toPane:split.secondPane];
  }
}

- (void)updateSurfaceSizes {
  [self updateSurfaceSizesInPane:self.rootPane];
}

- (void)updateSurfaceSizesInPane:(BGTerminalPaneView *)pane {
  if ([pane isKindOfClass:[BGTerminalSurfaceContainerView class]]) {
    [((BGTerminalSurfaceContainerView *)pane).surfaceView updateGhosttySize];
    return;
  }

  if ([pane isKindOfClass:[BGTerminalSplitView class]]) {
    BGTerminalSplitView *split = (BGTerminalSplitView *)pane;
    [self updateSurfaceSizesInPane:split.firstPane];
    [self updateSurfaceSizesInPane:split.secondPane];
  }
}

- (void)splitSurfaceView:(BGGhosttySurfaceView *)sourceSurface direction:(ghostty_action_split_direction_e)direction {
  BGTerminalSurfaceContainerView *sourcePane = (BGTerminalSurfaceContainerView *)sourceSurface.superview;
  if (sourcePane == nil) return;

  ghostty_surface_config_s inherited = ghostty_surface_inherited_config(sourceSurface.surface, GHOSTTY_SURFACE_CONTEXT_SPLIT);
  NSString *newSurfaceId = [NSString stringWithFormat:@"%@:split:%@", self.surfaceId, NSUUID.UUID.UUIDString];
  BGGhosttySurfaceView *newSurface = [[BGGhosttySurfaceView alloc] initWithHost:self.host surfaceId:newSurfaceId config:&inherited];
  if (newSurface == nil || newSurface.surface == nullptr) {
    return;
  }

  BGTerminalSurfaceContainerView *newPane = [[BGTerminalSurfaceContainerView alloc] initWithSurfaceView:newSurface];
  newPane.tabHost = self;
  [newPane setBackgroundHexColor:self.backgroundHexColor];
  sourcePane.tabHost = self;

  BGTerminalPaneView *firstPane = sourcePane;
  BGTerminalPaneView *secondPane = newPane;
  if (direction == GHOSTTY_SPLIT_DIRECTION_LEFT || direction == GHOSTTY_SPLIT_DIRECTION_UP) {
    firstPane = newPane;
    secondPane = sourcePane;
  }

  BGTerminalSplitView *splitView = [[BGTerminalSplitView alloc] initWithFirstPane:firstPane secondPane:secondPane direction:direction];
  splitView.tabHost = self;
  [splitView setNeedsLayout:YES];

  BGTerminalSplitView *parentSplit = sourcePane.splitParent;
  if (parentSplit != nil) {
    [parentSplit replaceChildPane:sourcePane withPane:splitView];
  } else {
    [self setRootPane:splitView];
  }

  [self updateSurfaceSizes];
  [self noteFocusedSurfaceView:newSurface];
  if (self.window != nil) {
    [self.window makeFirstResponder:newSurface];
  }
  [newSurface setGhosttyFocused:YES];
}

- (void)closeSurfaceView:(BGGhosttySurfaceView *)surfaceView {
  BGTerminalSurfaceContainerView *pane = (BGTerminalSurfaceContainerView *)surfaceView.superview;
  if (pane == nil) return;

  BGTerminalSplitView *parentSplit = pane.splitParent;
  if (parentSplit == nil) {
    [pane removeFromSuperview];
    self.rootPane = nil;
    self.activeSurfaceView = nil;
    return;
  }

  BGTerminalPaneView *sibling = [parentSplit siblingPaneForPane:pane];
  BGTerminalSplitView *grandparent = parentSplit.splitParent;
  if (grandparent != nil) {
    [grandparent replaceChildPane:parentSplit withPane:sibling];
  } else {
    [self setRootPane:sibling];
  }

  [parentSplit removeFromSuperview];
  [self updateSurfaceSizes];
  BGGhosttySurfaceView *nextFocus = [self firstSurfaceViewInPane:self.rootPane];
  self.activeSurfaceView = nextFocus;
  if (nextFocus != nil && self.window != nil) {
    [self.window makeFirstResponder:nextFocus];
    [nextFocus setGhosttyFocused:YES];
  }
}

@end

@implementation BGGhosttyHost

- (instancetype)initWithRootView:(NSView *)rootView {
  self = [super init];
  if (self == nil) {
    return nil;
  }

  _rootView = rootView;
  _tabs = [[NSMutableDictionary alloc] init];
  _tickScheduled = NO;

  if (!EnsureGhosttyInitialized()) {
    return nil;
  }

  _config = ghostty_config_new();
  if (_config == nullptr) {
    return self;
  }

  ghostty_config_load_default_files(_config);
  ghostty_config_load_recursive_files(_config);
  ghostty_config_load_file(_config, EmbeddedGhosttyOverridePath().UTF8String);
  ghostty_config_finalize(_config);

  ghostty_runtime_config_s runtime{};
  runtime.userdata = (__bridge void *)self;
  runtime.supports_selection_clipboard = true;
  runtime.wakeup_cb = HostWakeup;
  runtime.action_cb = HostAction;
  runtime.read_clipboard_cb = HostReadClipboard;
  runtime.confirm_read_clipboard_cb = HostConfirmReadClipboard;
  runtime.write_clipboard_cb = HostWriteClipboard;
  runtime.close_surface_cb = HostCloseSurface;

  _app = ghostty_app_new(&runtime, _config);
  if (_app != nullptr) {
    ghostty_app_set_focus(_app, NSApp.isActive);
  }

  return self;
}

- (BOOL)matchesRootView:(NSView *)rootView {
  return _rootView == rootView;
}

- (void)shutdown {
  for (BGTerminalTabHostView *tabHost in _tabs.allValues) {
    [tabHost removeFromSuperview];
  }
  [_tabs removeAllObjects];

  if (_app != nullptr) {
    ghostty_app_free(_app);
    _app = nullptr;
  }

  if (_config != nullptr) {
    ghostty_config_free(_config);
    _config = nullptr;
  }
}

- (void)dealloc {
  [self shutdown];
}

- (BOOL)createSurfaceWithId:(NSString *)surfaceId cwd:(NSString *)cwd {
  if (_app == nullptr || _rootView == nil || surfaceId.length == 0 || cwd.length == 0) {
    return NO;
  }
  if (_tabs[surfaceId] != nil) {
    return YES;
  }

  BGGhosttySurfaceView *view = [[BGGhosttySurfaceView alloc] initWithHost:self surfaceId:surfaceId cwd:cwd];
  if (view == nil || view.surface == nullptr) {
    return NO;
  }

  BGTerminalSurfaceContainerView *container = [[BGTerminalSurfaceContainerView alloc] initWithSurfaceView:view];
  if (container == nil) {
    return NO;
  }

  BGTerminalTabHostView *tabHost =
      [[BGTerminalTabHostView alloc] initWithHost:self surfaceId:surfaceId rootPane:container];
  if (tabHost == nil) {
    return NO;
  }

  tabHost.hidden = YES;
  [tabHost applyBackgroundHexColor:@"#34353d"];
  _tabs[surfaceId] = tabHost;
  [_rootView addSubview:tabHost];
  return YES;
}

- (void)destroySurfaceWithId:(NSString *)surfaceId {
  BGTerminalTabHostView *tabHost = _tabs[surfaceId];
  if (tabHost == nil) {
    return;
  }
  [tabHost removeFromSuperview];
  [_tabs removeObjectForKey:surfaceId];
}

- (BOOL)closeFocusedSurfaceWithId:(NSString *)surfaceId {
  BGTerminalTabHostView *tabHost = _tabs[surfaceId];
  BGGhosttySurfaceView *view = tabHost.focusedSurfaceView;
  BGTerminalSurfaceContainerView *pane =
      [view.superview isKindOfClass:[BGTerminalSurfaceContainerView class]]
          ? (BGTerminalSurfaceContainerView *)view.superview
          : nil;
  if (tabHost == nil || view == nil || pane == nil || pane.splitParent == nil) {
    return NO;
  }

  [tabHost closeSurfaceView:view];
  return YES;
}

- (void)setSurfaceFrame:(NSRect)frame forSurfaceId:(NSString *)surfaceId {
  BGTerminalTabHostView *tabHost = _tabs[surfaceId];
  if (tabHost == nil) {
    return;
  }
  tabHost.frame = frame;
  [tabHost setNeedsLayout:YES];
  [tabHost updateSurfaceSizes];
}

- (void)setSurfaceBackgroundHexColor:(NSString *)hexColor forSurfaceId:(NSString *)surfaceId {
  BGTerminalTabHostView *tabHost = _tabs[surfaceId];
  if (tabHost == nil) {
    return;
  }
  [tabHost applyBackgroundHexColor:hexColor];

  if (_app == nullptr) {
    return;
  }

  ghostty_config_t nextConfig = ghostty_config_new();
  if (nextConfig == nullptr) {
    return;
  }

  ghostty_config_load_default_files(nextConfig);
  ghostty_config_load_recursive_files(nextConfig);
  ghostty_config_load_file(nextConfig, EmbeddedGhosttyOverridePath().UTF8String);
  ghostty_config_load_file(nextConfig, BackgroundOverridePath(hexColor).UTF8String);
  ghostty_config_finalize(nextConfig);

  ghostty_app_update_config(_app, nextConfig);

  if (_config != nullptr) {
    ghostty_config_free(_config);
  }
  _config = nextConfig;

  [self scheduleTick];
}

- (void)setSurfaceVisible:(BOOL)visible forSurfaceId:(NSString *)surfaceId {
  BGTerminalTabHostView *tabHost = _tabs[surfaceId];
  if (tabHost == nil) {
    return;
  }
  [tabHost applyVisibility:visible];
}

- (void)focusSurfaceWithId:(NSString *)surfaceId {
  BGGhosttySurfaceView *view = [_tabs[surfaceId] focusedSurfaceView];
  if (view == nil || view.window == nil) {
    return;
  }
  [view.window makeFirstResponder:view];
  [view setGhosttyFocused:YES];
}

- (void)splitSurfaceWithId:(NSString *)surfaceId direction:(ghostty_action_split_direction_e)direction {
  BGGhosttySurfaceView *view = [_tabs[surfaceId] focusedSurfaceView];
  BGTerminalTabHostView *tabHost = _tabs[surfaceId];
  if (view == nil || tabHost == nil || view.surface == nullptr) {
    return;
  }
  [tabHost splitSurfaceView:view direction:direction];
}

- (void)setAppFocused:(BOOL)focused {
  if (_app != nullptr) {
    ghostty_app_set_focus(_app, focused);
  }
}

- (void)scheduleTick {
  if (_app == nullptr || _tickScheduled) {
    return;
  }

  _tickScheduled = YES;
  dispatch_async(dispatch_get_main_queue(), ^{
    self.tickScheduled = NO;
    if (self.app == nullptr) {
      return;
    }
    ghostty_app_tick(self.app);
    for (BGTerminalTabHostView *tabHost in self.tabs.allValues) {
      if (tabHost.hidden) {
        continue;
      }
      [self setNeedsDisplayInPane:tabHost.rootPane];
    }
  });
}

- (void)setNeedsDisplayInPane:(BGTerminalPaneView *)pane {
  if ([pane isKindOfClass:[BGTerminalSurfaceContainerView class]]) {
    [((BGTerminalSurfaceContainerView *)pane).surfaceView setNeedsDisplay:YES];
    return;
  }

  if ([pane isKindOfClass:[BGTerminalSplitView class]]) {
    BGTerminalSplitView *split = (BGTerminalSplitView *)pane;
    [self setNeedsDisplayInPane:split.firstPane];
    [self setNeedsDisplayInPane:split.secondPane];
  }
}

- (void)completeClipboardRequestForSurface:(BGGhosttySurfaceView *)surface
                                      text:(NSString *)text
                                     state:(void *)state
                                 confirmed:(BOOL)confirmed {
  if (surface.surface == nullptr) {
    return;
  }
  const char *utf8 = text.UTF8String;
  if (utf8 == nullptr) {
    return;
  }
  ghostty_surface_complete_clipboard_request(surface.surface, utf8, state, confirmed);
}

- (BGGhosttySurfaceView *)surfaceForTarget:(ghostty_target_s)target {
  if (target.tag != GHOSTTY_TARGET_SURFACE || target.target.surface == nullptr) {
    return nil;
  }
  void *userdata = ghostty_surface_userdata(target.target.surface);
  if (userdata == nullptr) {
    return nil;
  }
  return (__bridge BGGhosttySurfaceView *)userdata;
}

- (void)noteFocusedSurfaceView:(BGGhosttySurfaceView *)surfaceView {
  [[self tabHostForSurfaceView:surfaceView] noteFocusedSurfaceView:surfaceView];
}

- (void)closeSurfaceView:(BGGhosttySurfaceView *)surfaceView {
  [[self tabHostForSurfaceView:surfaceView] closeSurfaceView:surfaceView];
}

- (BGTerminalTabHostView *)tabHostForSurfaceView:(BGGhosttySurfaceView *)surfaceView {
  BGTerminalSurfaceContainerView *pane =
      [surfaceView.superview isKindOfClass:[BGTerminalSurfaceContainerView class]]
          ? (BGTerminalSurfaceContainerView *)surfaceView.superview
          : nil;
  return pane.tabHost;
}

- (NSDictionary<NSString *, id> *)resolvedAppearance {
  if (_config == nullptr) {
    return @{};
  }

  ghostty_config_color_s background{};
  if (!ghostty_config_get(_config, &background, "background", strlen("background"))) {
    return @{};
  }

  double backgroundOpacity = 1.0;
  (void)ghostty_config_get(
      _config,
      &backgroundOpacity,
      "background-opacity",
      strlen("background-opacity"));

  return @{
    @"backgroundColor": HexStringFromGhosttyColor(background),
    @"backgroundOpacity": @(1.0),
    @"configuredBackgroundOpacity": @(backgroundOpacity),
  };
}

- (BOOL)handleAction:(ghostty_action_s)action target:(ghostty_target_s)target {
  BGGhosttySurfaceView *surfaceView = [self surfaceForTarget:target];

  switch (action.tag) {
    case GHOSTTY_ACTION_SET_TITLE: {
      if (surfaceView == nil || action.action.set_title.title == nullptr) {
        return false;
      }
      surfaceView.titleText = [NSString stringWithUTF8String:action.action.set_title.title] ?: @"";
      return true;
    }

    case GHOSTTY_ACTION_PWD: {
      if (surfaceView == nil || action.action.pwd.pwd == nullptr) {
        return false;
      }
      surfaceView.workingDirectory = [NSString stringWithUTF8String:action.action.pwd.pwd] ?: surfaceView.workingDirectory;
      return true;
    }

    case GHOSTTY_ACTION_NEW_SPLIT: {
      if (surfaceView == nil) {
        return false;
      }
      __weak BGGhosttyHost *weakSelf = self;
      __weak BGGhosttySurfaceView *weakSurface = surfaceView;
      const ghostty_action_split_direction_e direction = action.action.new_split;
      dispatch_async(dispatch_get_main_queue(), ^{
        BGGhosttyHost *strongSelf = weakSelf;
        BGGhosttySurfaceView *strongSurface = weakSurface;
        if (strongSelf == nil || strongSurface == nil) {
          return;
        }
        BGTerminalTabHostView *tabHost = [strongSelf tabHostForSurfaceView:strongSurface];
        if (tabHost == nil) {
          return;
        }
        [tabHost splitSurfaceView:strongSurface direction:direction];
      });
      return true;
    }

    case GHOSTTY_ACTION_MOUSE_SHAPE: {
      if (surfaceView == nil) {
        return false;
      }
      surfaceView.cursorShape = CursorForShape(action.action.mouse_shape);
      [surfaceView.window invalidateCursorRectsForView:surfaceView];
      return true;
    }

    case GHOSTTY_ACTION_MOUSE_VISIBILITY: {
      if (surfaceView == nil) {
        return false;
      }
      surfaceView.cursorVisible = action.action.mouse_visibility == GHOSTTY_MOUSE_VISIBLE;
      [surfaceView.window invalidateCursorRectsForView:surfaceView];
      return true;
    }

    case GHOSTTY_ACTION_RING_BELL:
      NSBeep();
      return true;

    case GHOSTTY_ACTION_OPEN_URL: {
      if (action.action.open_url.url == nullptr) {
        return false;
      }
      NSString *urlString = [NSString stringWithUTF8String:action.action.open_url.url];
      if (urlString == nil) {
        return false;
      }
      NSURL *url = [NSURL URLWithString:urlString];
      if (url == nil) {
        url = [NSURL fileURLWithPath:urlString.stringByStandardizingPath];
      }
      if (url == nil) {
        return false;
      }
      [[NSWorkspace sharedWorkspace] openURL:url];
      return true;
    }

    default:
      return false;
  }
}

@end

static bool GetWindowHandle(napi_env env, napi_value value, NSView **outView) {
  bool isBuffer = false;
  if (napi_is_buffer(env, value, &isBuffer) != napi_ok || !isBuffer) {
    return false;
  }

  void *bufferData = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, value, &bufferData, &length) != napi_ok || length < sizeof(void *)) {
    return false;
  }

  void *nativeHandle = *reinterpret_cast<void **>(bufferData);
  *outView = (__bridge NSView *)nativeHandle;
  return *outView != nil;
}

static napi_value InitializeHost(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 1) {
    ThrowTypeError(env, "initializeHost requires a native window handle buffer");
    return nullptr;
  }

  NSView *rootView = nil;
  if (!GetWindowHandle(env, args[0], &rootView)) {
    ThrowTypeError(env, "initializeHost expected a BrowserWindow native handle buffer");
    return nullptr;
  }

  if (gHost != nil && [gHost matchesRootView:rootView]) {
    return MakeBoolean(env, gHost.app != nullptr);
  }

  if (gHost != nil) {
    [gHost shutdown];
    gHost = nil;
  }

  gHost = [[BGGhosttyHost alloc] initWithRootView:rootView];
  return MakeBoolean(env, gHost != nil && gHost.app != nullptr);
}

static napi_value ShutdownHost(napi_env env, napi_callback_info info) {
  (void)info;
  if (gHost != nil) {
    [gHost shutdown];
    gHost = nil;
  }
  return MakeUndefined(env);
}

static napi_value CreateSurface(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 2) {
    ThrowTypeError(env, "createSurface requires a surface id and cwd");
    return nullptr;
  }
  if (gHost == nil) {
    ThrowError(env, "native host is not initialized");
    return nullptr;
  }

  NSString *surfaceId = nil;
  NSString *cwd = nil;
  if (!GetStringArg(env, args[0], &surfaceId) || !GetStringArg(env, args[1], &cwd)) {
    ThrowTypeError(env, "createSurface expected string arguments");
    return nullptr;
  }

  return MakeBoolean(env, [gHost createSurfaceWithId:surfaceId cwd:cwd]);
}

static napi_value DestroySurface(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 1) {
    ThrowTypeError(env, "destroySurface requires a surface id");
    return nullptr;
  }
  if (gHost == nil) {
    return MakeUndefined(env);
  }

  NSString *surfaceId = nil;
  if (!GetStringArg(env, args[0], &surfaceId)) {
    ThrowTypeError(env, "destroySurface expected a string surface id");
    return nullptr;
  }

  [gHost destroySurfaceWithId:surfaceId];
  return MakeUndefined(env);
}

static napi_value CloseFocusedSurface(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 1) {
    ThrowTypeError(env, "closeFocusedSurface requires a surface id");
    return nullptr;
  }
  if (gHost == nil) {
    return MakeBoolean(env, false);
  }

  NSString *surfaceId = nil;
  if (!GetStringArg(env, args[0], &surfaceId)) {
    ThrowTypeError(env, "closeFocusedSurface expected a string surface id");
    return nullptr;
  }

  return MakeBoolean(env, [gHost closeFocusedSurfaceWithId:surfaceId]);
}

static napi_value SetSurfaceBounds(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 2) {
    ThrowTypeError(env, "setSurfaceBounds requires a surface id and bounds object");
    return nullptr;
  }
  if (gHost == nil) {
    return MakeUndefined(env);
  }

  NSString *surfaceId = nil;
  if (!GetStringArg(env, args[0], &surfaceId)) {
    ThrowTypeError(env, "setSurfaceBounds expected a string surface id");
    return nullptr;
  }

  double x = 0;
  double y = 0;
  double width = 0;
  double height = 0;
  if (!GetNumberProperty(env, args[1], "x", &x) || !GetNumberProperty(env, args[1], "y", &y) ||
      !GetNumberProperty(env, args[1], "width", &width) ||
      !GetNumberProperty(env, args[1], "height", &height)) {
    ThrowTypeError(env, "setSurfaceBounds expected numeric x/y/width/height");
    return nullptr;
  }

  [gHost setSurfaceFrame:NSMakeRect(x, y, width, height) forSurfaceId:surfaceId];
  return MakeUndefined(env);
}

static napi_value SetSurfaceVisible(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 2) {
    ThrowTypeError(env, "setSurfaceVisible requires a surface id and visible flag");
    return nullptr;
  }
  if (gHost == nil) {
    return MakeUndefined(env);
  }

  NSString *surfaceId = nil;
  bool visible = false;
  if (!GetStringArg(env, args[0], &surfaceId) || !GetBoolArg(env, args[1], &visible)) {
    ThrowTypeError(env, "setSurfaceVisible expected string and boolean arguments");
    return nullptr;
  }

  [gHost setSurfaceVisible:visible forSurfaceId:surfaceId];
  return MakeUndefined(env);
}

static napi_value GetResolvedAppearance(napi_env env, napi_callback_info info) {
  (void)info;
  if (gHost == nil) {
    return MakeUndefined(env);
  }

  NSDictionary<NSString *, id> *appearance = [gHost resolvedAppearance];
  napi_value result = nullptr;
  napi_create_object(env, &result);

  NSString *backgroundColor = appearance[@"backgroundColor"];
  if (backgroundColor != nil) {
    napi_value value = nullptr;
    napi_create_string_utf8(env, backgroundColor.UTF8String, NAPI_AUTO_LENGTH, &value);
    napi_set_named_property(env, result, "backgroundColor", value);
  }

  NSNumber *backgroundOpacity = appearance[@"backgroundOpacity"];
  if (backgroundOpacity != nil) {
    napi_value value = nullptr;
    napi_create_double(env, backgroundOpacity.doubleValue, &value);
    napi_set_named_property(env, result, "backgroundOpacity", value);
  }

  return result;
}

static napi_value SetSurfaceBackground(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 2) {
    ThrowTypeError(env, "setSurfaceBackground requires a surface id and color");
    return nullptr;
  }
  if (gHost == nil) {
    return MakeUndefined(env);
  }

  NSString *surfaceId = nil;
  NSString *hexColor = nil;
  if (!GetStringArg(env, args[0], &surfaceId) || !GetStringArg(env, args[1], &hexColor)) {
    ThrowTypeError(env, "setSurfaceBackground expected string arguments");
    return nullptr;
  }

  [gHost setSurfaceBackgroundHexColor:hexColor forSurfaceId:surfaceId];
  return MakeUndefined(env);
}

static napi_value FocusSurface(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 1) {
    ThrowTypeError(env, "focusSurface requires a surface id");
    return nullptr;
  }
  if (gHost == nil) {
    return MakeUndefined(env);
  }

  NSString *surfaceId = nil;
  if (!GetStringArg(env, args[0], &surfaceId)) {
    ThrowTypeError(env, "focusSurface expected a string surface id");
    return nullptr;
  }

  [gHost focusSurfaceWithId:surfaceId];
  return MakeUndefined(env);
}

static napi_value SplitSurface(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 2) {
    ThrowTypeError(env, "splitSurface requires a surface id and direction");
    return nullptr;
  }
  if (gHost == nil) {
    return MakeUndefined(env);
  }

  NSString *surfaceId = nil;
  NSString *direction = nil;
  if (!GetStringArg(env, args[0], &surfaceId) || !GetStringArg(env, args[1], &direction)) {
    ThrowTypeError(env, "splitSurface expected string arguments");
    return nullptr;
  }

  ghostty_action_split_direction_e ghosttyDirection = GHOSTTY_SPLIT_DIRECTION_RIGHT;
  if ([direction isEqualToString:@"down"]) {
    ghosttyDirection = GHOSTTY_SPLIT_DIRECTION_DOWN;
  } else if ([direction isEqualToString:@"left"]) {
    ghosttyDirection = GHOSTTY_SPLIT_DIRECTION_LEFT;
  } else if ([direction isEqualToString:@"up"]) {
    ghosttyDirection = GHOSTTY_SPLIT_DIRECTION_UP;
  }

  [gHost splitSurfaceWithId:surfaceId direction:ghosttyDirection];
  return MakeUndefined(env);
}

static napi_value SetAppFocused(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 1) {
    ThrowTypeError(env, "setAppFocused requires a focused flag");
    return nullptr;
  }
  if (gHost == nil) {
    return MakeUndefined(env);
  }

  bool focused = false;
  if (!GetBoolArg(env, args[0], &focused)) {
    ThrowTypeError(env, "setAppFocused expected a boolean argument");
    return nullptr;
  }

  [gHost setAppFocused:focused];
  return MakeUndefined(env);
}

static napi_value IsAvailable(napi_env env, napi_callback_info info) {
  (void)info;
  return MakeBoolean(env, true);
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptors[] = {
      {"isAvailable", nullptr, IsAvailable, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"initializeHost", nullptr, InitializeHost, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"shutdownHost", nullptr, ShutdownHost, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"createSurface", nullptr, CreateSurface, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"destroySurface", nullptr, DestroySurface, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"closeFocusedSurface", nullptr, CloseFocusedSurface, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setSurfaceBounds", nullptr, SetSurfaceBounds, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getResolvedAppearance", nullptr, GetResolvedAppearance, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setSurfaceBackground", nullptr, SetSurfaceBackground, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setSurfaceVisible", nullptr, SetSurfaceVisible, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"focusSurface", nullptr, FocusSurface, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"splitSurface", nullptr, SplitSurface, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setAppFocused", nullptr, SetAppFocused, nullptr, nullptr, nullptr, napi_default, nullptr},
  };

  napi_define_properties(env, exports, sizeof(descriptors) / sizeof(*descriptors), descriptors);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
