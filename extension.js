// Minimal completion provider for NXC keywords and builtins.
const vscode = require('vscode');

const KEYWORDS = [
  'task','repeat','for','while','do','if','else','return','break','continue','switch','case','default'
];
const TYPES = [
  'bool','byte','char','int','long','short','string','float','unsigned','signed','void'
];
const BUILTINS = [
  // Motor control
  'OnFwd','OnRev','OnFwdSync','OnRevSync','OnFwdReg','OnRevReg','Off','Coast','Float',
  'RotateMotor','RotateMotorEx','RotateMotorPID','RotateMotorPIDEx','ResetAllTachoCounts',
  // Timing / random
  'Wait','CurrentTick','ResetTimer','ClearTimer','Random',
  // Sound
  'PlayTone','PlayToneEx','PlayFile','PlayFileEx','SetSoundVolume','MuteSound',
  // Sensors / configuration
  'Sensor','SensorValue','SetSensorType','SetSensorMode','ReadSensor','ClearSensor','SetSensor','SetSensorLight','SetSensorSound','SetSensorLowspeed','SensorUS','SensorHTCompass',
  // Display / graphics
  'TextOut','NumOut','ClearScreen','RectOut','CircleOut','LineOut','PointOut','GraphicOut',
  // Task control
  'StartTask','StopTask','StopAllTasks','Precedes','Follows','Priority','Yield',
  // Flow (some dialect extras)
  'until'
];
const CONSTANTS = [
  'OUT_A','OUT_B','OUT_C','OUT_AB','OUT_AC','OUT_BC','OUT_ABC','OUT_ALL',
  'IN_1','IN_2','IN_3','IN_4','TRUE','FALSE','NULL',
  'SENSOR_1','SENSOR_2','SENSOR_3','SENSOR_4',
  // Sensor modes/types (subset)
  'SENSOR_TOUCH','SENSOR_LIGHT','SENSOR_SOUND','SENSOR_ULTRASONIC',
  // Motor regulation modes
  'OUT_REGMODE_IDLE','OUT_REGMODE_SPEED','OUT_REGMODE_SYNC'
];

function activate(context) {
  const all = [...KEYWORDS, ...TYPES, ...BUILTINS, ...CONSTANTS];
  const provider = vscode.languages.registerCompletionItemProvider('nxc', {
    provideCompletionItems(doc, pos) {
      const range = doc.getWordRangeAtPosition(pos) || new vscode.Range(pos, pos);
      return all.map(word => {
        const item = new vscode.CompletionItem(word, vscode.CompletionItemKind.Keyword);
        if (BUILTINS.includes(word)) item.kind = vscode.CompletionItemKind.Function;
        if (CONSTANTS.includes(word)) item.kind = vscode.CompletionItemKind.Constant;
        if (TYPES.includes(word)) item.kind = vscode.CompletionItemKind.TypeParameter;
        item.range = range;
        return item;
      });
    }
  }, '.'); // trigger also after '.' (future proof if needed)

  context.subscriptions.push(provider);
}

function deactivate() {}

module.exports = { activate, deactivate };
