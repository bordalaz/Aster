from migrate.buttons import prefills


def test_prefills_builder_and_hand_written():
    builder = ('CONCATENATE(IF("x","https://airtable.com/app/shruRnkyquncOS0HC"),'
               'CONCATENATE("?prefill_" & ENCODE_URL_COMPONENT("Оборудование"),\r\n "=" & ENCODE_URL_COMPONENT({column_value_fldSTDcLacDDS6VgO} & "")),'
               'CONCATENATE("&prefill_" & ENCODE_URL_COMPONENT("Статус"),\r\n "=" & ENCODE_URL_COMPONENT("Разобрали")))')
    assert prefills(builder) == [("Оборудование", "fldSTDcLacDDS6VgO"), ("Статус", "=Разобрали")]
    hand = ("'https://airtable.com/app/shr7GZe43bKnIqMrJ'&'?prefill_P/N%20ID='&RECORD_ID()&'&prefill_P/N='"
            "&ENCODE_URL_COMPONENT({column_value_fldtw359eWdT9PKvM})&'&hide_P/N%20ID=true'")
    assert prefills(hand) == [("P/N ID", "record"), ("P/N", "fldtw359eWdT9PKvM")]
