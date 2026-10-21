import unittest

from akshare_provider.service import charset_from_content_type, decode_html_bytes


class TextDecodingTest(unittest.TestCase):
    def test_decodes_gbk_announced_by_the_content_type(self):
        payload = "<p>浦发银行</p>".encode("gbk")

        self.assertEqual(decode_html_bytes(payload, "text/html; charset=GBK"), "<p>浦发银行</p>")

    def test_falls_back_to_gb18030_when_no_charset_is_declared(self):
        payload = "<p>浦发银行</p>".encode("gb18030")

        self.assertEqual(decode_html_bytes(payload, "text/html"), "<p>浦发银行</p>")

    def test_keeps_utf8_payloads_intact(self):
        payload = "<p>浦发银行</p>".encode("utf-8")

        self.assertEqual(decode_html_bytes(payload, "text/html; charset=utf-8"), "<p>浦发银行</p>")

    def test_replaces_undecodable_bytes_instead_of_dropping_them(self):
        decoded = decode_html_bytes(b"<p>\xff\xfe\xfa</p>", "text/html")

        self.assertIn("\ufffd", decoded)
        self.assertNotEqual(decoded, "<p></p>")

    def test_reads_the_charset_label_from_the_content_type(self):
        self.assertEqual(charset_from_content_type("text/html; charset=GBK"), "gb18030")
        self.assertEqual(charset_from_content_type('text/html; charset="utf-8"'), "utf-8")
        self.assertIsNone(charset_from_content_type("text/html"))
        self.assertIsNone(charset_from_content_type(None))


if __name__ == "__main__":
    unittest.main()
