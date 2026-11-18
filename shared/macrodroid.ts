// File .macro per MacroDroid (Android), pronto da importare: notifica di un'app di banca → POST all'indirizzo privato.
// Formato preso da macro esportate da MacroDroid (macroExportVersion 1). Il corpo è testo a righe, non JSON:
// il testo delle notifiche può contenere virgolette o "&" che romperebbero JSON e moduli.
//   riga 1: ledgy-md1   riga 2: pacchetto dell'app   riga 3: titolo   resto: testo della notifica
import { KNOWN_APPS } from './apps';

export const MACRO_MARK = 'ledgy-md1';

/** Legge il corpo mandato dalla macro; null se non è nel formato a righe. */
export function parseMacroBody(raw: string): { app: string; title: string; text: string; source: string } | null {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() !== MACRO_MARK) return null;
  return { app: (lines[1] ?? '').trim(), title: (lines[2] ?? '').trim(), text: lines.slice(3).join('\n').trim(), source: 'macrodroid' };
}

const ANDROID_APPS = Object.entries(KNOWN_APPS).filter(([pkg]) => !pkg.startsWith('com.apple.'));
const guid = () => String(-Math.floor(1e17 + Math.random() * 8e17));

export function buildMacro(url: string, apps: Array<[string, string]> = ANDROID_APPS): string {
  const macro = {
    macro: {
      disabledTimestamp: 0, exportedActionBlocks: [], forceEvenIfNotEnabledTimestamp: 0, isActionBlock: false, isBeingImported: false,
      isClonedInstance: false, isExtra: false, isFavourite: false, lastEditedTimestamp: Date.now(), localVariables: [], m_GUID: guid(),
      m_category: 'Ledgy', m_constraintList: [], m_description: 'Manda a Ledgy le notifiche delle app di banca scelte. Aggiungi o togli app nel trigger.',
      m_descriptionOpen: false, m_enabled: true, m_excludeLog: false, m_headingColor: 0, m_isOrCondition: false, m_name: 'Ledgy spese',
      m_triggerList: [{
        enableRegex: false, ignoreCase: true,
        m_applicationNameList: apps.map(([, name]) => name), m_packageNameList: apps.map(([pkg]) => pkg),
        m_exactMatch: false, m_excludeApps: false, m_excludes: false, m_ignoreOngoing: true, m_option: 0, m_soundOption: 0,
        m_supressMultiples: true, m_textContent: '', m_SIGUID: guid(), m_classType: 'NotificationTrigger',
        m_constraintList: [], m_isDisabled: false, m_isOrCondition: false,
      }],
      m_actionList: [{
        requestConfig: {
          allowAnyCertificate: false, basicAuthEnabled: false, basicAuthPassword: '', basicAuthUsername: '', blockNextAction: false,
          contentBodyFileDisplayName: '', contentBodyFileUri: '', contentBodySource: 0,
          contentBodyText: `${MACRO_MARK}\n{not_app_package}\n{not_title}\n{notification}`,
          contentType: 'text/plain', followRedirects: true, headerParams: [], queryParams: [], requestTimeOutSeconds: 30,
          requestType: 1, responseVariableName: '', returnCodeVariableName: '', saveResponseFileName: '', saveResponseFolderPathDisplayName: '',
          saveResponseFolderPathUri: '', saveResponseType: 0, saveReturnCodeToVariable: false, saveReturnHeadersToVariable: false,
          urlToOpen: url,
        },
        m_SIGUID: guid(), m_classType: 'HttpRequestAction', m_constraintList: [], m_isDisabled: false, m_isOrCondition: false,
      }],
    },
    macroExportVersion: 1,
  };
  return JSON.stringify(macro, null, 1);
}
