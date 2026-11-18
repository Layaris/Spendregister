#!/usr/bin/env python3
"""Genera il comando iPhone "Ledgy" (file .shortcut NON firmato).

Manda il testo della notifica di pagamento al server Ledgy, che la legge con i suoi lettori per
banca e fa controlli, cambio, regole, categoria e anti-duplicati.

- Niente Apple Intelligence sul telefono (versione 2, 18 nov 2026): il passo "Usa modello" a volte
  rifiutava la notifica e il comando si fermava prima dell'invio, perdendo la spesa. Il server
  legge da solo le notifiche delle banche; quelle che non capisce restano in Altro › Cattura.
- Nessuna notifica mostrata dal comando (scelta del proprietario): le spese da rivedere si vedono
  nell'app. Nell'automazione va spento anche "Notifica all'esecuzione".
- Senza notifica in ingresso (lanciato a mano o dall'automazione "Ora del giorno")
  manda solo il segnale giornaliero a <indirizzo>/ping.
- Se il database non risponde il server mette la notifica in coda (inbound_queue) e risponde 202:
  il comando finisce senza errori e la spesa si registra appena il database torna.
- All'installazione iOS chiede l'indirizzo privato del telefono (domanda di importazione).

Il file va firmato (HubSign o un Mac) prima di poterlo installare su iPhone.
Uso: python3 tools/shortcut/build_shortcut.py [cartella_di_uscita]
"""
import plistlib
import sys
import uuid
from pathlib import Path

OBJ = '￼'


def new_uuid() -> str:
    return str(uuid.uuid4()).upper()


def text(s: str) -> dict:
    return {'Value': {'string': s}, 'WFSerializationType': 'WFTextTokenString'}


def output_ref(uid: str, name: str) -> dict:
    return {'OutputUUID': uid, 'Type': 'ActionOutput', 'OutputName': name}


def token(parts: list) -> dict:
    """Testo con variabili: parts è una lista di stringhe e riferimenti (dict)."""
    s, att = '', {}
    for p in parts:
        if isinstance(p, str):
            s += p
        else:
            att[f'{{{len(s)}, 1}}'] = p
            s += OBJ
    return {'Value': {'string': s, 'attachmentsByRange': att}, 'WFSerializationType': 'WFTextTokenString'}


def attachment(ref: dict) -> dict:
    return {'Value': ref, 'WFSerializationType': 'WFTextTokenAttachment'}


def notification_part(prop: str) -> dict:
    return {'Type': 'ExtensionInput', 'Aggrandizements': [{'Type': 'WFPropertyVariableAggrandizement', 'PropertyName': prop}]}


def action(ident: str, **params) -> dict:
    return {'WFWorkflowActionIdentifier': f'is.workflow.actions.{ident}', 'WFWorkflowActionParameters': params}


def dict_items(pairs: list) -> dict:
    return {
        'Value': {'WFDictionaryFieldValueItems': [{'WFItemType': 0, 'WFKey': text(k), 'WFValue': v} for k, v in pairs]},
        'WFSerializationType': 'WFDictionaryFieldValue',
    }


def build() -> dict:
    u_url, u_text, u_resp = new_uuid(), new_uuid(), new_uuid()
    g_empty = new_uuid()

    url = output_ref(u_url, 'Indirizzo Ledgy')
    full = output_ref(u_text, 'Testo pagamento completo')

    actions = [
        # 0. Indirizzo privato del telefono: chiesto all'installazione.
        action('gettext', UUID=u_url, CustomOutputName='Indirizzo Ledgy', WFTextActionText=text('https://incolla-qui-il-tuo-indirizzo-ledgy')),
        # 1. Titolo, sottotitolo e testo della notifica.
        action('gettext', UUID=u_text, CustomOutputName='Testo pagamento completo',
               WFTextActionText=token([notification_part('Title'), '\n', notification_part('Subtitle'), '\n', notification_part('Body')])),
        # 2-5. Nessuna notifica: manda solo il segnale giornaliero e termina.
        action('conditional', GroupingIdentifier=g_empty, WFControlFlowMode=0, WFCondition=101,
               WFInput={'Type': 'Variable', 'Variable': attachment(full)}),
        action('downloadurl', UUID=new_uuid(), WFURL=token([url, '/ping']), WFHTTPMethod='POST'),
        action('output', UUID=new_uuid()),
        action('conditional', GroupingIdentifier=g_empty, WFControlFlowMode=2, UUID=new_uuid()),
        # 6. Invio al server: legge la notifica, fa i controlli e decide. Nessun altro passo che possa fallire prima.
        action('downloadurl', UUID=u_resp, CustomOutputName='Risposta Ledgy', WFURL=token([url]), WFHTTPMethod='POST', WFHTTPBodyType='JSON',
               WFJSONValues=dict_items([
                   ('source', text('ios-shortcut')),
                   ('title', token([notification_part('Title')])),
                   ('text', token([full])),
                   ('posted_at', token([{'Type': 'CurrentDate', 'Aggrandizements': [{'Type': 'WFDateFormatVariableAggrandizement', 'WFDateFormatStyle': 'ISO 8601', 'WFISO8601IncludeTime': True}]}])),
               ])),
    ]

    return {
        'WFWorkflowClientVersion': '1505.3',
        'WFWorkflowMinimumClientVersion': 5015,
        'WFWorkflowMinimumClientVersionString': '5015',
        'WFWorkflowIcon': {'WFWorkflowIconGlyphNumber': 59719, 'WFWorkflowIconStartColor': 431817727},
        'WFWorkflowTypes': ['WFWorkflowTypeShowInSearch'],
        'WFWorkflowInputContentItemClasses': ['WFStringContentItem', 'WFRichTextContentItem', 'WFAppContentItem', 'WFDateContentItem'],
        'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowHasShortcutInputVariables': True,
        'WFWorkflowHasOutputFallback': False,
        'WFQuickActionSurfaces': [],
        'WFWorkflowImportQuestions': [{
            'ActionIndex': 0,
            'Category': 'Parameter',
            'ParameterKey': 'WFTextActionText',
            'DefaultValue': 'https://incolla-qui-il-tuo-indirizzo-ledgy',
            'Text': 'Incolla l’indirizzo privato di questo iPhone (Ledgy → Altro → Cattura automatica → Collega un telefono)',
        }],
        'WFWorkflowActions': actions,
    }


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / 'out')
    out.mkdir(parents=True, exist_ok=True)
    wf = build()
    (out / 'Ledgy.shortcut').write_bytes(plistlib.dumps(wf, fmt=plistlib.FMT_BINARY))
    (out / 'Ledgy.plist.xml').write_bytes(plistlib.dumps(wf, fmt=plistlib.FMT_XML))
    print(f'Creato {out / "Ledgy.shortcut"} ({len(wf["WFWorkflowActions"])} azioni, non firmato)')


if __name__ == '__main__':
    main()
