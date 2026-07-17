/**
 * Centralised list of supported test subjects.
 *
 * Add new subjects here as the platform expands. The Mongoose enum on the
 * Test and Question models reads from this array, so a single edit propagates
 * everywhere (DB validation, admin UI dropdown, homepage filter pills).
 *
 * Keep the order stable — the homepage "All" pill is followed by subjects in
 * the order listed here.
 */
const SUBJECTS = ['Math', 'MDCAT', 'ECAT'];

module.exports = { SUBJECTS };
