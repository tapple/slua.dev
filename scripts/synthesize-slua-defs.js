/*
	This script uses LSL definitions to synthesize SLua-specific definitions based on what we know:
	- The LSL definitions had been used to generate SLua code
	- ll* functions are available in the `llcompat` library
		- with exactly same signature/behavior as in LSL
	- ll* functions are available in the `ll` library
		- Signature adjusted for SLua, e.g. 1-based indices, boolean returns, etc.
	- Some ll* functions are removed from SLua's `ll` library (see RemovedFunctions)
	- Some ll* functions are duplicates of native Luau libraries (see DuplicateFunctions)
*/

import { readFile, writeFile, mkdir, access, unlink } from 'fs/promises';
import { load, dump } from 'js-yaml';

const lslDefinitionsPath = 'src/data/lsl_definitions.yaml';
const sluaDefinitionsPath = 'src/data/slua_definitions.yaml';

// These functions were removed from SLua's ll.* for these reasons
const RemovedFunctions = {
	'SetTimerEvent': 'Conflicts with LLTimers',
	'ResetTime': 'Conflicts with LLTimers',
	'GetAndResetTime': 'Conflicts with LLTimers',
	'SetMemoryLimit': 'Not applicable to SLua',
};

// These functions exist through SLua's ll.* but really duplicate the functionality of some of the native libraries available from Luau
// Native functionality may likely perform better (particularly those marked as 'fastcall functions', such as in math) or be more idiomatic to use
// This list is used to mark such functions in the documentation as duplicates, suggesting to use native instead (`.duplicates = DuplicateFunctions[name]`)
const DuplicateFunctions = {
	'Base642String', 'llbase64.decode',
	'String2Base64', 'llbase64.encode',
	'Json2List', 'lljson.decode',
	'List2Json', 'lljson.encode',
	'Abs': 'math.abs',
	'Fabs': 'math.fabs',
	'Ceil': 'math.ceil',
	'Round': 'math.round',
	'Floor': 'math.floor',
	'ModPow': '(a^b)%c',
	'Sqrt': 'math.sqrt',
	'Sin': 'math.sin',
	'Cos': 'math.cos',
	'Tan': 'math.tan',
	'Asin': 'math.asin',
	'Acos': 'math.acos',
	'Atan': 'math.atan',
	'Atan2': 'math.atan2',
	'Pow': 'math.pow',
	'Exp': 'math.exp',
	'Log': 'math.log',
	'Log10': 'math.log10',
	'Frand': 'math.random',
	'Char': 'string.char, utf8.char',
	'Ord': 'string.byte, utf8.codepoint',
	'CSV2List': 'string.split',
	'GetTime': 'os.clock',
	'GetUnixTime': 'os.time',
	'GetTimestamp': 'os.date',
	'GetDate': 'os.date',
	'Rot2Fwd': 'quaternion.tofwd',
	'Rot2Left': 'quaternion.toleft',
	'Rot2Up': 'quaternion.toup',
	'StringLength': '#string, string.len, utf8.len',
	'GetListLength': '#table',
	'ListSort': 'table.sort',
	'DumpList2String': 'table.concat',
	'List2CSV': 'table.concat(", ")',
	'ListFindList': 'table.find',
	'ListFindListNext': 'table.find',
	'ListInsertList': 'table.move',
	'ListReplaceList': 'table.move',
	'ToUpper': 'string.upper',
	'ToLower': 'string.lower',
	'VecMag': 'vector.magnitude',
	'VecNorm': 'vector.normalize',
	'VecDist': 'vector.magnitude(v1 - v2)',
};

// Luau fastcall functions are optimized for performance
// https://luau.org/performance#specialized-builtin-function-calls
// This list is used to mark such functions (`.fastcall = true`)
const Fastcalls = [
	'assert',
	
	// math.
	'math.abs',
	'math.acos',
	'math.asin',
	'math.atan2',
	'math.atan',
	'math.ceil',
	'math.cosh',
	'math.cos',
	'math.deg',
	'math.exp',
	'math.floor',
	'math.fmod',
	'math.frexp',
	'math.ldexp',
	'math.log10',
	'math.log',
	'math.max',
	'math.min',
	'math.modf',
	'math.pow',
	'math.rad',
	'math.sinh',
	'math.sin',
	'math.sqrt',
	'math.tanh',
	'math.tan',
	
	// bit32.
	'bit32.arshift',
	'bit32.band',
	'bit32.bnot',
	'bit32.bor',
	'bit32.bxor',
	'bit32.btest',
	'bit32.extract',
	'bit32.lrotate',
	'bit32.lshift',
	'bit32.replace',
	'bit32.rrotate',
	'bit32.rshift',
	
	// type()
	'type',
	
	// string.
	'string.byte',
	'string.char',
	'string.len',
	
	// typeof()
	'typeof',
	
	// string.
	'string.sub',
	
	// math.
	'math.clamp',
	'math.sign',
	'math.round',
	
	// raw*
	'rawset',
	'rawget',
	'rawequal',
	
	// table.
	'table.insert',
	'table.unpack',
	
	// vector ctor
	'vector',
	
	// bit32.count
	'bit32.countlz',
	'bit32.countrz',
	
	// select(_, ...)
	'select',
	
	// rawlen
	'rawlen',
	
	// bit32.extract(_, k, k)
	'bit32.extract',
	
	// get/setmetatable
	'getmetatable',
	'setmetatable',
	
	// tonumber/tostring
	'tonumber',
	'tostring',
	
	// bit32.byteswap(n)
	'bit32.byteswap',
	
	// buffer.
	'buffer.readi8',
	'buffer.readu8',
	'buffer.writeu8',
	'buffer.readi16',
	'buffer.readu16',
	'buffer.writeu16',
	'buffer.readi32',
	'buffer.readu32',
	'buffer.writeu32',
	'buffer.readf32',
	'buffer.writef32',
	'buffer.readf64',
	'buffer.writef64',
	
	// vector.
	'vector.magnitude',
	'vector.normalize',
	'vector.cross',
	'vector.dot',
	'vector.floor',
	'vector.ceil',
	'vector.abs',
	'vector.sign',
	'vector.clamp',
	'vector.min',
	'vector.max',
	
	// math.lerp
	'math.lerp',
	
	// vector.lerp
	'vector.lerp',
	
	// math.
	'math.isnan',
	'math.isinf',
	'math.isfinite'
];

// When converting definitions translate keys to uuids, rotations to quaternions, integers to numbers, bool-semantics to boolean, etc.
function convertType(type, value) {
	// If a string but is actually UUID format, convert to uuid
	if(type == 'string' && typeof value === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) return 'uuid';
	
	// Map types from LSL to SLua
	if(type === 'key') return 'uuid';
	if(type === 'rotation') return 'quaternion';
	if(type === 'integer') return 'number';
	if(type === 'float') return 'number';
	if(type === 'string') return 'string';
	if(type === 'vector') return 'vector';
	if(type === 'list') return 'table';
	if(type === 'boolean') return 'boolean';
	return type; // leave as-is
}


const lsl = load(await readFile(lslDefinitionsPath, 'utf8'));

// Hardcoded SLua base definitions, merged/synthesized with LSL-based definitions
const slua = {
	types: {
		nil: {
			tooltip: 'nil represents nothing. It is the default value of uninitialized variables and the absence of a value in tables.',
		},
		boolean: {
			tooltip: 'A true or false value.',
			operators: [
				{
					group: 'logical',
					list: [
						{ operator: 'and' },
						{ operator: 'or' },
						{ operator: 'not' },
					]
				}
			]
		},
		number: {
			tooltip: 'Numeric value stored as a double-precision floating point number. Large enough to represent large integer numbers up to 2^53.',
			operators: [
				{
					group: 'arithmetic',
					list: [
						{ left: 'number', operator: '+', right: 'number', return: 'number' },
						{ left: 'number', operator: '-', right: 'number', return: 'number' },
						{ left: 'number', operator: '*', right: 'number', return: 'number' },
						{ left: 'number', operator: '/', right: 'number', return: 'number' },
						{ left: 'number', operator: '//', right: 'number', return: 'number' },
						{ left: 'number', operator: '^', right: 'number', return: 'number' },
						{ left: 'number', operator: '%', right: 'number', return: 'number' },
						{ operand: 'number', operator: 'unary -', return: 'number' },
					]
				},
				{
					group: 'assignment',
					list: [
						{ operator: '+=', right: 'number' },
						{ operator: '-=', right: 'number' },
						{ operator: '*=', right: 'number' },
						{ operator: '/=', right: 'number' },
						{ operator: '//=', right: 'number' },
						{ operator: '^=', right: 'number' },
						{ operator: '%=', right: 'number' },
					]
				},
				{
					group: 'comparison',
					list: [
						{ operator: '<' },
						{ operator: '<=' },
						{ operator: '>' },
						{ operator: '>=' },
						{ operator: '==' },
						{ operator: '~=' },
					]
				},
			],
			constructors: [
				{ name: '1337', literal: true, type: 'number', tooltip: 'Numeric literal representing the number.' },
				{ name: '12.5', literal: true, type: 'number', tooltip: 'Numeric literal representing the number.' },
				{ name: '3.14e2', literal: true, type: 'number', tooltip: 'Scientific notation numeric literal representing the number.' },
				{ name: '0x1A3F', literal: true, type: 'number', tooltip: 'Hexadecimal numeric literal representing the number.' },
				{ name: '0b1010', literal: true, type: 'number', tooltip: 'Binary numeric literal representing the number.' },
				{ name: 'tonumber', type: 'function tonumber(value: any): number?', tooltip: 'Converts a value to a number if possible; returns nil if conversion fails.' },
			],
		},
		vector: {
			tooltip: 'Type that contains a set of three 32-bit floating point values',
			operators: [
				{
					group: 'arithmetic',
					list: [
						{ left: 'vector', operator: '+', right: 'vector', return: 'vector' },
						{ left: 'vector', operator: '-', right: 'vector', return: 'vector' },
						{ left: 'vector', operator: '*', right: 'number', return: 'vector', tooltip: 'Multiplies each component by the number' },
						{ left: 'vector', operator: '/', right: 'number', return: 'vector', tooltip: 'Divides each component by the number' },
						{ left: 'vector', operator: '*', right: 'quaternion', return: 'vector', tooltip: 'Rotate vector by quaternion' },
						{ left: 'vector', operator: '/', right: 'quaternion', return: 'vector', tooltip: 'Rotate vector by inverse of quaternion' },
						{ operand: 'vector', operator: 'unary -', return: 'vector' },
					]
				},
				{
					group: 'assignment',
					list: [
						{ operator: '+=', right: 'vector' },
						{ operator: '-=', right: 'vector' },
						{ operator: '*=', right: 'number' },
						{ operator: '/=', right: 'number' },
					]
				},
				{
					group: 'comparison',
					list: [
						{ operator: '==' },
						{ operator: '~=' },
					]
				},
			],
			constants: {
				'vector.zero': { tooltip: 'Vector with all components set to 0. Equivalent to vector(0, 0, 0).' },
				'vector.one': { tooltip: 'Vector with all components set to 1. Equivalent to vector(1, 1, 1).' },
			},
			components: {
				x: { type: 'number', tooltip: 'The X component of the vector.' },
				y: { type: 'number', tooltip: 'The Y component of the vector.' },
				z: { type: 'number', tooltip: 'The Z component of the vector.' },
			},
			constructors: [
				{ name: 'vector', type: 'function vector(x: number, y: number, z: number): vector', tooltip: 'Creates a new vector with the specified components.' },
				{ name: 'vector.create', type: 'function vector.create(x: number, y: number, z: number): vector', tooltip: 'Creates a new vector with the specified components.' },
				{ name: 'tovector', type: 'function tovector(string: string): vector', tooltip: 'Converts a string representation of a vector into a vector type.' },
			],
			methods: [
				{ group: 'Vector Operations', list: [
					{ name: 'magnitude', type: 'function vector.magnitude(v: vector): number', tooltip: 'Returns the magnitude (length) of the vector.' },
					{ name: 'normalize', type: 'function vector.normalize(v: vector): vector', tooltip: 'Returns a normalized (unit length) version of the vector.' },
					{ name: 'cross', type: 'function vector.cross(v1: vector, v2: vector): vector', tooltip: 'Returns the cross product of two vectors.' },
					{ name: 'dot', type: 'function vector.dot(v1: vector, v2: vector): number', tooltip: 'Returns the dot product of two vectors.' },
					{ name: 'angle', type: 'function vector.angle(v1: vector, v2: vector, axis: vector?): number', tooltip: 'Returns the angle in radians between two vectors, optionally around a specified axis.' },
					{ name: 'lerp', type: 'function vector.lerp(a: vector, b: vector, t: number): vector', tooltip: 'Linearly interpolates between two vectors based on parameter t (0 to 1).' },
				]},
				{ group: 'Component-wise Operations', list: [
					{ name: 'abs', type: 'function vector.abs(v: vector): vector', tooltip: 'Returns a vector with the absolute values of each component.' },
					{ name: 'floor', type: 'function vector.floor(v: vector): vector', tooltip: 'Returns a vector with each component rounded down to the nearest integer.' },
					{ name: 'ceil', type: 'function vector.ceil(v: vector): vector', tooltip: 'Returns a vector with each component rounded up to the nearest integer.' },
					{ name: 'sign', type: 'function vector.sign(v: vector): vector', tooltip: 'Returns a vector with the sign of each component (-1, 0, or 1).' },
				]},
				{ group: 'Min/Max/Clamp', list: [
					{ name: 'min', type: 'function vector.min(...: vector): vector', tooltip: 'Returns a vector containing the minimum components from the provided vectors.' },
					{ name: 'max', type: 'function vector.max(...: vector): vector', tooltip: 'Returns a vector containing the maximum components from the provided vectors.' },
					{ name: 'clamp', type: 'function vector.clamp(v: vector, min: vector, max: vector): vector', tooltip: 'Clamps each component of the vector between the corresponding components of min and max vectors.' },
				]},
			],
		},
		quaternion: {
			tooltip: 'Quaternion represent an orientation in 3D space.',
			operators: [
				{
					group: 'arithmetic',
					list: [
						{ left: 'quaternion', operator: '*', right: 'quaternion', return: 'quaternion', tooltip: 'Rotate quaternion by another quaternion' },
						{ left: 'quaternion', operator: '/', right: 'quaternion', return: 'quaternion', tooltip: 'Rotate quaternion by inverse of another quaternion' },
						{ left: 'vector', operator: '*', right: 'quaternion', return: 'vector', tooltip: 'Rotate vector by quaternion' },
						{ left: 'vector', operator: '/', right: 'quaternion', return: 'vector', tooltip: 'Rotate vector by inverse of quaternion' },
						{ left: 'quaternion', operator: '+', right: 'quaternion', return: 'quaternion', tooltip: 'Adds corresponding components' },
						{ left: 'quaternion', operator: '-', right: 'quaternion', return: 'quaternion', tooltip: 'Subtracts corresponding components' },
						{ operand: 'quaternion', operator: 'unary -', return: 'quaternion', tooltip: 'Negates all components; Does not produce the inverse rotation!' },
					]
				},
			],
			constants: {
				'quaternion.identity': { tooltip: 'The identity quaternion representing default/no rotation. Equivalent to quaternion(0, 0, 0, 1).' },
			},
			components: {
				x: { type: 'number', tooltip: 'The X component of the quaternion.' },
				y: { type: 'number', tooltip: 'The Y component of the quaternion.' },
				z: { type: 'number', tooltip: 'The Z component of the quaternion.' },
				s: { type: 'number', tooltip: 'The S component of the quaternion.' },
			},
			constructors: [
				{ name: 'quaternion', type: 'function quaternion(x: number, y: number, z: number, s: number): quaternion', tooltip: 'Creates a new quaternion with the specified components.' },
				{ name: 'quaternion.create', type: 'function quaternion.create(x: number, y: number, z: number, s: number): quaternion', tooltip: 'Creates a new quaternion with the specified components.' },
				{ name: 'torotation', type: 'function torotation(string: string): quaternion', tooltip: 'Converts a string representation of a quaternion into a quaternion type.' },
			],
			methods: [
				{ name: 'normalize', type: 'function quaternion.normalize(q: quaternion): quaternion', tooltip: 'Returns a normalized version of the quaternion.' },
				{ name: 'magnitude', type: 'function quaternion.magnitude(q: quaternion): number', tooltip: 'Returns the magnitude (length) of the quaternion.' },
				{ name: 'conjugate', type: 'function quaternion.conjugate(q: quaternion): quaternion', tooltip: 'Returns the conjugate (inverse) of the quaternion.' },
				{ name: 'dot', type: 'function quaternion.dot(a: quaternion, b: quaternion): number', tooltip: 'Returns the dot product of two quaternions.' },
				{ name: 'slerp', type: 'function quaternion.slerp(a: quaternion, b: quaternion, t: number): quaternion', tooltip: 'Performs spherical linear interpolation between two quaternions.' },
				{ name: 'tofwd', type: 'function quaternion.tofwd(q: quaternion): vector', tooltip: 'Returns the forward vector from the quaternion.' },
				{ name: 'toleft', type: 'function quaternion.toleft(q: quaternion): vector', tooltip: 'Returns the left vector from the quaternion.' },
				{ name: 'toup', type: 'function quaternion.toup(q: quaternion): vector', tooltip: 'Returns the up vector from the quaternion.' },
			],
			related: [
				{ name: 'll.AngleBetween', type: 'function ll.AngleBetween(a: quaternion, b: quaternion): number', tooltip: 'Returns the angle in radians between two quaternions.' },
				{ name: 'll.Axes2Rot', type: 'function ll.Axes2Rot(forward: vector, left: vector, up: vector): quaternion', tooltip: 'Constructs a quaternion from the given orthogonal axes.' },
				{ name: 'll.AxisAngle2Rot', type: 'function ll.AxisAngle2Rot(axis: vector, angle: number): quaternion', tooltip: 'Constructs a quaternion from an axis and an angle in radians.' },
				{ name: 'll.Euler2Rot', type: 'function ll.Euler2Rot(v: vector): quaternion', tooltip: 'Constructs a quaternion from Euler angles (in radians).' },
				{ name: 'll.Rot2Angle', type: 'function ll.Rot2Angle(q: quaternion): number', tooltip: 'Returns the angle in radians represented by the quaternion.' },
				{ name: 'll.Rot2Axis', type: 'function ll.Rot2Axis(q: quaternion): vector', tooltip: 'Returns the axis of rotation represented by the quaternion.' },
				{ name: 'll.Rot2Euler', type: 'function ll.Rot2Euler(q: quaternion): vector', tooltip: 'Returns the Euler angles (in radians) represented by the quaternion.' },
				{ name: 'll.RotBetween', type: 'function ll.RotBetween(a: vector, b: vector): quaternion', tooltip: 'Returns the quaternion representing the rotation from vector a to vector b.' },
			]
		},
		string: {
			tooltip: 'Sequence of characters representing text.',
			operators: [
				{
					group: 'concatenation',
					list: [
						{ left: 'string', operator: '..', right: 'string', return: 'string' },
						{ operator: '..=', right: 'string' },
					]
				},
				{
					group: 'comparison',
					tooltip: "Lexicographical order based on each ASCII byte, e.g. 'A' < 'a', '420' < '69', etc.",
					list: [
						{ operator: '<' },
						{ operator: '<=' },
						{ operator: '>' },
						{ operator: '>=' },
						{ operator: '==' },
						{ operator: '~=' },
					]
				},
			],
			constructors: [
				{ name: '""', literal: true, type: 'string', tooltip: 'Literal string enclosed in double quotes.' },
				{ name: "''", literal: true, type: 'string', tooltip: 'Literal string enclosed in single quotes.' },
				{ name: '``', literal: true, type: 'string', tooltip: 'Interpolated string enclosed in double quotes, allowing embedded expressions using {expression} syntax.' },
				{ name: '[[]]', literal: true, type: 'string', tooltip: 'Literal string enclosed in double square brackets, allowing multi-line strings without escape sequences.' },
				{ name: '[=[]=]', literal: true, type: 'string', tooltip: 'Literal string enclosed in double square brackets with equal signs, allowing multi-line strings without escape sequences and nesting. You can stack multiple levels of equal signs to nest strings.' },
				{ name: 'tostring', type: 'function tostring(value: any): string', tooltip: 'Converts a value to its string representation.' },
			],
			methods: [
				{ group: 'String Manipulation', list: [
					{ name: 'sub', type: 'function string.sub(s: string, f: number, t: number?): string', tooltip: 'Returns the substring of s from index f to t. If t is omitted, returns to the end of the string.' },
					{ name: 'lower', type: 'function string.lower(s: string): string', tooltip: 'Returns a copy of s with all uppercase letters converted to lowercase.' },
					{ name: 'upper', type: 'function string.upper(s: string): string', tooltip: 'Returns a copy of s with all lowercase letters converted to uppercase.' },
					{ name: 'rep', type: 'function string.rep(s: string, n: number): string', tooltip: 'Returns a new string which is the concatenation of n copies of s.' },
					{ name: 'reverse', type: 'function string.reverse(s: string): string', tooltip: 'Returns a new string which is the reverse of s.' },
					{ name: 'len', type: 'function string.len(s: string): number', tooltip: 'Returns the length of the string s.' },
				]},
				{ group: 'Splitting', list: [
					{ name: 'split', type: 'function string.split(s: string, separator: string?): {string}', tooltip: 'Splits the string s into a table of substrings based on the specified separator. If no separator is provided, splits on whitespace.' },
				]},
				{ group: 'Formatting', list: [
					{ name: 'format', type: 'function string.format(format: string, ...: any): string', tooltip: 'Returns a formatted string using the specified format and arguments.' },
				]},
				{ group: 'Pattern Matching', list: [
					{ name: 'find', type: 'function string.find(s: string, pattern: string, init: number?, plain: boolean?): (number?, number?, ...string)', tooltip: 'Searches for the first occurrence of the pattern in the string s, starting from index init. If plain is true, treats the pattern as a plain substring.' },
					{ name: 'match', type: 'function string.match(s: string, pattern: string, init: number?): ...string?', tooltip: 'Looks for the first match of the pattern in the string s, starting from index init. Returns the captures from the match.' },
					{ name: 'gsub', type: 'function string.gsub(s: string, pattern: string, replacement: string | table | (...string) -> string, max: number?): (string, number)', tooltip: 'Returns a copy of s in which all (or the first max) occurrences of the pattern have been replaced by the replacement.' },
					{ name: 'gmatch', type: 'function string.gmatch(s: string, pattern: string): <iterator>', tooltip: 'Returns an iterator function that, each time it is called, returns the next captures from the pattern found in the string s.' },
				]},
				{ group: 'Byte and Character Operations', list: [
					{ name: 'byte', type: 'function string.byte(s: string, f: number?, t: number?): ...number', tooltip: 'Returns the internal numerical codes of the characters in s from index f to t.' },
					{ name: 'char', type: 'function string.char(...: number): string', tooltip: 'Receives zero or more integers and returns a string with the corresponding characters.' },
				]},
				{ group: 'Packing and Unpacking', list: [
					{ name: 'pack', type: 'function string.pack(format: string, ...: any): string', tooltip: 'Packs the given values into a binary string according to the specified format.' },
					{ name: 'unpack', type: 'function string.unpack(format: string, s: string, pos: number?): ...any', tooltip: 'Unpacks the binary string s according to the specified format, starting from position pos.' },
				]},
			],
			related: [
				{ name: 'll.DeleteSubString', type: 'function ll.DeleteSubString(source: string, start: number, end: number): string', tooltip: 'Deletes the substring from start to end indices in the source string and returns the modified string.' },
				{ name: 'll.GetSubString', type: 'function ll.GetSubString(string: string, start: number, end: number): string', tooltip: 'Returns the substring from start to end indices of the given string.' },
				{ name: 'll.InsertString', type: 'function ll.InsertString(target: string, position: number, source: string): string', tooltip: 'Inserts the source string into the target string at the specified position and returns the modified string.' },
				{ name: 'll.ReplaceSubString', type: 'function ll.ReplaceSubString(initial: string, substring: string, replacement: string, count: number): string', tooltip: 'Replaces occurrences of substring with replacement in the initial string up to count times and returns the modified string.' },
				{ name: 'll.StringTrim', type: 'function ll.StringTrim(text: string, trimType: STRING_TRIM | STRING_TRIM_HEAD | STRING_TRIM_TAIL): string', tooltip: 'Trims whitespace from the text based on the specified trim type and returns the modified string.' },
				{ name: 'll.SubStringIndex', type: 'function ll.SubStringIndex(text: string, sequence: string): number', tooltip: 'Returns the index of the first occurrence of sequence in text, or -1 if not found.' },
			],
		},
		uuid: {
			tooltip: '128-bit universally unique identifier (UUID).',
			constants: {
				NULL_KEY: { tooltip: 'UUID with all bytes set to zero.' },
			},
			access: {
				istruthy: { type: 'boolean', tooltip: 'Indicates whether the UUID is not the NULL_KEY (all bytes zero).' },
				bytes: { type: 'string', tooltip: 'Returns the raw byte representation of the UUID as a string.' },
			},
			constructors: [
				{ name: 'uuid', type: 'function uuid(key: string | buffer | uuid): uuid', tooltip: 'Creates a UUID from a string, buffer, or another UUID.' },
				{ name: 'uuid.create', type: 'function uuid.create(key: string | buffer | uuid): uuid', tooltip: 'Creates a UUID from a string, buffer, or another UUID.' },
				{ name: 'touuid', type: 'function touuid(key: string | buffer | uuid): uuid', tooltip: 'Converts a string, buffer, or another UUID into a UUID type.' },
			],
			related: [
				{ name: 'll.GenerateKey', type: 'function ll.GenerateKey(): uuid', tooltip: 'Generates and returns a new unique UUID.' },
				{ name: 'll.GetKey', type: 'function ll.GetKey(): uuid', tooltip: 'Returns the UUID of the current script.' },
				{ name: 'll.GetObjectLinkKey', type: 'function ll.GetObjectLinkKey(object: uuid, link: number): uuid', tooltip: 'Returns the UUID of the linked object specified by link number.' },
				{ name: 'll.GetOwner', type: 'function ll.GetOwner(): uuid', tooltip: 'Returns the UUID of the owner of the object containing the script.' },
				{ name: 'll.GetOwnerKey', type: 'function ll.GetOwnerKey(object: uuid): uuid', tooltip: 'Returns the UUID of the owner of the specified object.' },
			],
		},
		rotation: {
			private: true,
			alias: 'quaternion',
			tooltip: 'Quaternion representing an orientation in 3D space.',
		},
		table: {
			tooltip: 'Tables are the main data structure. They are objects that are implemented as associative arrays, this means an array that can be indexed with keys not only by numbers, but also strings or any other value of the language (except nil).',
			constructors: [
				{ name: '{}', type: 'table', tooltip: 'Creates and returns a new empty table.' },
				{ name: 'table.create', type: 'function table.create(n: number, value: any?): {any}', tooltip: 'Creates and returns a new table with n elements, each initialized to value (or nil if not provided).' },
			],
			methods: [
				{ group: 'Table Manipulation', list: [
					{ name: 'insert', type: 'function table.insert(list: {any}, value: any)', tooltip: 'Inserts value at the end of the list.' },
					{ name: 'insert', type: 'function table.insert(list: {any}, position: number, value: any)', tooltip: 'Inserts value at the specified position in the list.' },
					{ name: 'remove', type: 'function table.remove(list: {any}, position: number?): any?', tooltip: 'Removes and returns the element at the specified position in the list. If position is not provided, removes the last element.' },
					{ name: 'move', type: 'function table.move(source: {any}, sourceFrom: number, sourceTo: number, destPosition: number, destination: {any}?)', tooltip: 'Moves elements from source table to destination table.' },
					{ name: 'clear', type: 'function table.clear(table: {any})', tooltip: 'Removes all elements from the table.' },
				]},
				{ group: 'Conversion', list: [
					{ name: 'pack', type: 'function table.pack(...: any): { [number]: any, n: number }', tooltip: 'Packs the given arguments into a table and returns it.' },
					{ name: 'unpack', type: 'function table.unpack(list: {any}, from: number?, to: number?): ...any', tooltip: 'Returns the elements from the list table from index from to to as separate return values.' },
					{ name: 'concat', type: 'function table.concat(list: {string}, separator: string?, from: number?, to: number?): string', tooltip: 'Concatenates the elements of the list table into a single string, separated by separator.' },
				]},
				{ group: 'Query', list: [
					{ name: 'find', type: 'function table.find(table: {any}, value: any, start: number?): number?', tooltip: 'Searches for a value in the table and returns its index if found.' },
					{ name: 'sort', type: 'function table.sort(list: {any}, comparison: ((a: any, b: any) -> boolean)?)', tooltip: 'Sorts the elements of the list in-place.' },
				]},
				{ group: 'Additional Utilities', list: [
					{ name: 'maxn', type: 'function table.maxn(list: {any}): number', tooltip: 'Returns the largest positive numerical index of the table.' },
					{ name: 'freeze', type: 'function table.freeze(table: table): table', tooltip: 'Freezes the table, preventing any further modifications.' },
					{ name: 'isfrozen', type: 'function table.isfrozen(table: table): boolean', tooltip: 'Checks if the table is frozen.' },
					{ name: 'clone', type: 'function table.clone(table: table): table', tooltip: 'Creates and returns a shallow copy of the table.' },
					{ name: 'shrink', type: 'function table.shrink(table: table, reorder: boolean?): table', tooltip: 'Removes nil values from the table. If reorder is true, compacts the table to remove gaps.' },
				]},
			],
		},
		thread: {
			tooltip: 'A thread represents a separate execution context for running coroutines.',
			constructors: [
				{ name: 'coroutine.create', type: 'function coroutine.create(func: (...: any) -> ...any): thread', tooltip: 'Creates a new thread (coroutine) with the given function as its body.' },
			],
			methods: [
				{ name: 'resume', type: 'function coroutine.resume(co: thread, ...: any): (boolean, ...any)', tooltip: 'Resumes the execution of the coroutine co, passing any additional arguments to it. Returns true followed by any values yielded or returned by the coroutine, or false followed by an error message if an error occurred.' },
				{ name: 'yield', type: 'function coroutine.yield(...: any): ...any', tooltip: 'Suspends the execution of the current coroutine, returning any provided values to the caller of resume.' },
				{ name: 'status', type: 'function coroutine.status(co: thread): string', tooltip: 'Returns the status of the coroutine co. Possible values are "running", "suspended", "normal", and "dead".' },
				{ name: 'wrap', type: 'function coroutine.wrap(func: (...: any) -> ...any): (...: any) -> ...any', tooltip: 'Creates a new coroutine with the given function and returns a function that, when called, resumes the coroutine.' },
			],
		},
		buffer: {
			tooltip: 'A buffer is a contiguous block of memory used to store binary data.',
			constructors: [
				{ name: 'buffer.create', type: 'function buffer.create(size: number): buffer', tooltip: 'Creates a new buffer of the specified size in bytes.' },
				{ name: 'buffer.fromstring', type: 'function buffer.fromstring(str: string): buffer', tooltip: 'Creates a new buffer initialized with the contents of the given string.' },
			],
			methods: [
				{ group: 'Buffer Management', list: [
					{ name: 'len', type: 'function buffer.len(b: buffer): number', tooltip: 'Returns the length of the buffer in bytes.' },
					{ name: 'copy', type: 'function buffer.copy(target: buffer, targetOffset: number, source: buffer, sourceOffset: number?, count: number?): ()', tooltip: 'Copies data from the source buffer to the target buffer.' },
					{ name: 'fill', type: 'function buffer.fill(b: buffer, offset: number, value: number, count: number?): ()', tooltip: 'Fills a portion of the buffer with the specified byte value.' },
					{ name: 'tostring', type: 'function buffer.tostring(b: buffer): string', tooltip: 'Converts the contents of the buffer to a string.' },
				]},
				{ group: 'Bits Read/Write', list: [
					{ name: 'readbits', type: 'function buffer.readbits(b: buffer, bitOffset: number, bitCount: number): number', tooltip: 'Reads a specified number of bits from the buffer starting at the given bit offset.' },
					{ name: 'writebits', type: 'function buffer.writebits(b: buffer, bitOffset: number, bitCount: number, value: number): ()', tooltip: 'Writes a specified number of bits to the buffer starting at the given bit offset.' },
				]},
				{ group: 'Numeric Read Operations', list: [
					{ name: 'readi8', type: 'function buffer.readi8(b: buffer, offset: number): number', tooltip: 'Reads a signed 8-bit integer from the buffer at the specified offset.' },
					{ name: 'readu8', type: 'function buffer.readu8(b: buffer, offset: number): number', tooltip: 'Reads an unsigned 8-bit integer from the buffer at the specified offset.' },
					{ name: 'readi16', type: 'function buffer.readi16(b: buffer, offset: number): number', tooltip: 'Reads a signed 16-bit integer from the buffer at the specified offset.' },
					{ name: 'readu16', type: 'function buffer.readu16(b: buffer, offset: number): number', tooltip: 'Reads an unsigned 16-bit integer from the buffer at the specified offset.' },
					{ name: 'readi32', type: 'function buffer.readi32(b: buffer, offset: number): number', tooltip: 'Reads a signed 32-bit integer from the buffer at the specified offset.' },
					{ name: 'readu32', type: 'function buffer.readu32(b: buffer, offset: number): number', tooltip: 'Reads an unsigned 32-bit integer from the buffer at the specified offset.' },
					{ name: 'readf32', type: 'function buffer.readf32(b: buffer, offset: number): number', tooltip: 'Reads a 32-bit floating point number from the buffer at the specified offset.' },
					{ name: 'readf64', type: 'function buffer.readf64(b: buffer, offset: number): number', tooltip: 'Reads a 64-bit floating point number from the buffer at the specified offset.' },
				]},
				{ group: 'Numeric Write Operations', list: [
					{ name: 'writei8', type: 'function buffer.writei8(b: buffer, offset: number, value: number): ()', tooltip: 'Writes a signed 8-bit integer to the buffer at the specified offset.' },
					{ name: 'writeu8', type: 'function buffer.writeu8(b: buffer, offset: number, value: number): ()', tooltip: 'Writes an unsigned 8-bit integer to the buffer at the specified offset.' },
					{ name: 'writei16', type: 'function buffer.writei16(b: buffer, offset: number, value: number): ()', tooltip: 'Writes a signed 16-bit integer to the buffer at the specified offset.' },
					{ name: 'writeu16', type: 'function buffer.writeu16(b: buffer, offset: number, value: number): ()', tooltip: 'Writes an unsigned 16-bit integer to the buffer at the specified offset.' },
					{ name: 'writei32', type: 'function buffer.writei32(b: buffer, offset: number, value: number): ()', tooltip: 'Writes a signed 32-bit integer to the buffer at the specified offset.' },
					{ name: 'writeu32', type: 'function buffer.writeu32(b: buffer, offset: number, value: number): ()', tooltip: 'Writes an unsigned 32-bit integer to the buffer at the specified offset.' },
					{ name: 'writef32', type: 'function buffer.writef32(b: buffer, offset: number, value: number): ()', tooltip: 'Writes a 32-bit floating point number to the buffer at the specified offset.' },
					{ name: 'writef64', type: 'function buffer.writef64(b: buffer, offset: number, value: number): ()', tooltip: 'Writes a 64-bit floating point number to the buffer at the specified offset.' },
				]},
				{ group: 'String Read/Write', list: [
					{ name: 'readstring', type: 'function buffer.readstring(b: buffer, offset: number, count: number): string', tooltip: 'Reads a string of the specified length from the buffer starting at the given offset.' },
					{ name: 'writestring', type: 'function buffer.writestring(b: buffer, offset: number, value: string, count: number?): ()', tooltip: 'Writes a string to the buffer starting at the given offset. If count is provided, writes up to count bytes.' },
				]},
			],
		},
		DetectedEvent: {
			tooltip: 'Special type representing the event data passed to detected events: sensor, touch and collision.',
			access: {
				index: { type: 'number', tooltip: 'The index of the detected object in the event.' },
				valid: { type: 'boolean', tooltip: 'Indicates whether the detected object is still valid.' },
				canAdjustDamage: { type: 'boolean', tooltip: 'Indicates whether the damage can be adjusted for this event.' },
			},
			methods: [
				{ group: 'Info about the detected object', list: [
					{ name: 'getKey', type: 'function DetectedEvent.getKey(): uuid', tooltip: 'Returns the UUID of the detected object.' },
					{ name: 'getName', type: 'function DetectedEvent.getName(): string', tooltip: 'Returns the name of the detected object.' },
					{ name: 'getOwner', type: 'function DetectedEvent.getOwner(): uuid', tooltip: 'Returns the UUID of the owner of the detected object.' },
					{ name: 'getGroup', type: 'function DetectedEvent.getGroup(): boolean', tooltip: 'Returns whether the detected object is owned by the same group as the script.' },
					{ name: 'getType', type: 'function DetectedEvent.getType(): number', tooltip: 'Returns the type of the detected object.' },
					{ name: 'getRezzer', type: 'function DetectedEvent.getRezzer(): uuid', tooltip: 'Returns the UUID of the rezzer of the detected object.' },
				]},
				{ group: 'Physical properties of the detected object', list: [
					{ name: 'getPos', type: 'function DetectedEvent.getPos(): vector', tooltip: 'Returns the position of the detected object.' },
					{ name: 'getRot', type: 'function DetectedEvent.getRot(): quaternion', tooltip: 'Returns the rotation of the detected object.' },
					{ name: 'getVel', type: 'function DetectedEvent.getVel(): vector', tooltip: 'Returns the velocity of the detected object.' },
				]},
				{ group: 'Link the event is associated with', list: [
					{ name: 'getLinkNumber', type: 'function DetectedEvent.getLinkNumber(): number', tooltip: 'Returns the link number associated with the event.' },
				]},
				{ group: 'Touch specific properties', list: [
					{ name: 'getTouchFace', type: 'function DetectedEvent.getTouchFace(): vector', tooltip: 'Returns the face normal at the touch point.' },
					{ name: 'getTouchBinormal', type: 'function DetectedEvent.getTouchBinormal(): vector', tooltip: 'Returns the binormal vector at the touch point.' },
					{ name: 'getTouchNormal', type: 'function DetectedEvent.getTouchNormal(): vector', tooltip: 'Returns the normal vector at the touch point.' },
					{ name: 'getTouchPos', type: 'function DetectedEvent.getTouchPos(): vector', tooltip: 'Returns the position of the touch point.' },
					{ name: 'getTouchST', type: 'function DetectedEvent.getTouchST(): vector', tooltip: 'Returns the ST texture coordinates at the touch point.' },
					{ name: 'getTouchUV', type: 'function DetectedEvent.getTouchUV(): vector', tooltip: 'Returns the UV texture coordinates at the touch point.' },
				]},
				{ group: 'Grab specific properties', list: [
					{ name: 'getGrab', type: 'function DetectedEvent.getGrab(): vector', tooltip: 'Returns the grab offset vector.' },
				]},
				{ group: 'Damage specific', list: [
					{ name: 'getDamage', type: 'function DetectedEvent.getDamage(): {number, number, number}', tooltip: 'Returns a table containing the {damage, type, and original damage values}.' },
					{ name: 'adjustDamage', type: 'function DetectedEvent.adjustDamage(newDamage: number): ()', tooltip: 'Adjusts the damage value for the event to newDamage.' },
				]},
			],
		},
	},
	libraries: {
		// Luau
		global: {
			constants: [
				{ name: '_G', type: 'table', tooltip: 'The global environment table.' },
				{ name: '_VERSION', type: 'string', tooltip: 'The version of the Lua interpreter.' },
			],
			functions: [
				{ group: 'Type Conversion', list: [
					{ name: 'type', type: 'function type(obj: any): string', tooltip: 'Returns the type of the given object as a string.' },
					{ name: 'typeof', type: 'function typeof(obj: any): string', tooltip: 'Returns the type of the given object as a string.' },
					{ name: 'tonumber', type: 'function tonumber(s: string, base: number?): number?', tooltip: 'Converts a string to a number in the specified base (default is base 10).' },
					{ name: 'tostring', type: 'function tostring(obj: any): string', tooltip: 'Converts an object to its string representation.' },
					{ name: 'tovector', type: 'function tovector(s: string): vector', tooltip: 'Converts a string representation of a vector into a vector type.' },
					{ name: 'toquaternion', type: 'function toquaternion(s: string): quaternion', tooltip: 'Converts a string representation of a quaternion into a quaternion type.' },
					{ name: 'torotation', type: 'function torotation(s: string): quaternion', tooltip: 'Converts a string representation of a rotation into a quaternion type.' },
					{ name: 'touuid', type: 'function touuid(s: string): uuid', tooltip: 'Converts a string representation of a UUID into a uuid type.' },
				]},
				{ group: 'Error Handling and Debugging', list: [
					{ name: 'print', type: 'function print(args: ...any)', tooltip: 'Prints the given arguments to the console.' },
					{ name: 'assert', type: 'function assert<T>(value: T, message: string?): T', tooltip: 'Asserts that the value is truthy; otherwise, raises an error with the optional message.' },
					{ name: 'error', type: 'function error(obj: any, level: number?)', tooltip: 'Raises an error with the given object and optional level.' },
				]},
				{ group: 'Metatables', list: [
					{ name: 'getmetatable', type: 'function getmetatable(obj: any): table?', tooltip: 'Returns the metatable of the given object, or nil if it has none.' },
					{ name: 'setmetatable', type: 'function setmetatable(t: table, mt: table?)', tooltip: 'Sets the metatable for the given table to mt.' },
				]},
				{ group: 'Protected Calls', list: [
					{ name: 'pcall', type: 'function pcall(f: function, args: ...any): (boolean, ...any)', tooltip: 'Calls function f in protected mode, returning a status and results.' },
					{ name: 'xpcall', type: 'function xpcall(f: function, e: function, args: ...any): (boolean, ...any)', tooltip: 'Calls function f in protected mode with error handler e, returning a status and results.' },
				]},
				{ group: 'Userdata Creation', list: [
					{ name: 'newproxy', type: 'function newproxy(mt: boolean?): userdata', tooltip: 'Creates a new userdata object with an optional metatable.' },
				]},
				{ group: 'Module loading for bundlers', list: [
					{ name: 'dangerouslyexecuterequiredmodule', type: 'function dangerouslyexecuterequiredmodule(f: (...any) -> ...any): ...any', tooltip: 'Executes a required module function in a dangerous context.' },
				]},
				{ group: 'Raw Access', list: [
					{ name: 'rawget', type: 'function rawget<K, V>(t: { [K]: V }, k: K): V?', tooltip: 'Gets the value associated with key k in table t without invoking metamethods.' },
					{ name: 'rawset', type: 'function rawset<K, V>(t: { [K] : V }, k: K, v: V)', tooltip: 'Sets the value v for key k in table t without invoking metamethods.' },
					{ name: 'rawlen', type: 'function rawlen<K, V>(t: { [K]: V } | string): number', tooltip: 'Returns the length of the table or string without invoking metamethods.' },
					{ name: 'rawequal', type: 'function rawequal(a: any, b: any): boolean', tooltip: 'Checks if two values are equal without invoking metamethods.' },
				]},
				{ group: 'Iteration and Selection', list: [
					{ name: 'next', type: 'function next<K, V>(t: { [K]: V }, i: K?): (K, V)?', tooltip: 'Returns the next key-value pair in the table t after key i.' },
					{ name: 'select', type: 'function select<T>(i: string, args: ...T): number', tooltip: 'Returns the number of arguments passed if i is "#".' },
					{ name: 'select', type: 'function select<T>(i: number, args: ...T): ...T', tooltip: 'Returns all arguments from position i to the end.' },
					{ name: 'ipairs', type: 'function ipairs(t: table): <iterator>', tooltip: 'Returns an iterator for traversing the array part of the table t.' },
					{ name: 'pairs', type: 'function pairs(t: table): <iterator>', tooltip: 'Returns an iterator for traversing all key-value pairs in the table t.' },
				]},
			],
		},
		math: {
			constants: [
				{ name: 'pi', type: 'number', tooltip: 'The mathematical constant π, approximately 3.14159.' },
				{ name: 'huge', type: 'number', tooltip: 'A value larger than any other numeric value. 2^1024' },
			],
			functions: [
				{ group: 'Basic Functions', list: [
					{ name: 'abs', type: 'function math.abs(n: number): number', tooltip: 'Absolute value of a number.' },
					{ name: 'floor', type: 'function math.floor(n: number): number', tooltip: 'Number rounded down to the nearest integer.' },
					{ name: 'ceil', type: 'function math.ceil(n: number): number', tooltip: 'Number rounded up to the nearest integer.' },
					{ name: 'round', type: 'function math.round(n: number): number', tooltip: 'Number rounded to the nearest integer.' },
					{ name: 'sign', type: 'function math.sign(n: number): number', tooltip: 'Returns the sign of a number: -1 for negative, 1 for positive, and 0 for zero.' },
					{ name: 'min', type: 'function math.min(list: ...number): number', tooltip: 'Returns the smallest number from a list of numbers.' },
					{ name: 'max', type: 'function math.max(list: ...number): number', tooltip: 'Returns the largest number from a list of numbers.' },
					{ name: 'clamp', type: 'function math.clamp(n: number, min: number, max: number): number', tooltip: 'Restricts a number to be within a specified range.' },
				]},
				{ group: 'Angle Conversion and Interpolation', list: [
					{ name: 'deg', type: 'function math.deg(n: number): number', tooltip: 'Convert radians to degrees.' },
					{ name: 'rad', type: 'function math.rad(n: number): number', tooltip: 'Convert degrees to radians.' },
					{ name: 'lerp', type: 'function math.lerp(a: number, b: number, t: number): number', tooltip: 'Linearly interpolate between two values.' },
					{ name: 'map', type: 'function math.map(x: number, inMin: number, inMax: number, outMin: number, outMax: number): number', tooltip: 'Map a number from one range to another.' },
				]},
				{ group: 'Random Numbers and Perlin Noise', list: [
					{ name: 'random', type: 'function math.random(): number\nfunction math.random(n: number): number\nfunction math.random(min: number, max: number): number', tooltip: 'Generate random numbers. Without arguments, returns a float between 0 and 1. With one argument, returns an integer between 1 and n. With two arguments, returns an integer between min and max.' },
					{ name: 'noise', type: 'function math.noise(x: number, y: number?, z: number?): number', tooltip: 'Generate Perlin noise value for given coordinates.' },
				]},
				{ group: 'Trigonometric Functions', list: [
					{ name: 'sqrt', type: 'function math.sqrt(n: number): number', tooltip: 'Square root of a number.' },
					{ name: 'cos', type: 'function math.cos(n: number): number', tooltip: 'Cosine of an angle in radians.' },
					{ name: 'sin', type: 'function math.sin(n: number): number', tooltip: 'Sine of an angle in radians.' },
					{ name: 'tan', type: 'function math.tan(n: number): number', tooltip: 'Tangent of an angle in radians.' },
					{ name: 'cosh', type: 'function math.cosh(n: number): number', tooltip: 'Hyperbolic cosine of a number.' },
					{ name: 'sinh', type: 'function math.sinh(n: number): number', tooltip: 'Hyperbolic sine of a number.' },
					{ name: 'tanh', type: 'function math.tanh(n: number): number', tooltip: 'Hyperbolic tangent of a number.' },
					{ name: 'acos', type: 'function math.acos(n: number): number', tooltip: 'Arc cosine of a number.' },
					{ name: 'asin', type: 'function math.asin(n: number): number', tooltip: 'Arc sine of a number.' },
					{ name: 'atan2', type: 'function math.atan2(y: number, x: number): number', tooltip: 'Arc tangent of y/x considering the signs of both to determine the correct quadrant.' },
					{ name: 'atan', type: 'function math.atan(n: number): number', tooltip: 'Arc tangent of a number.' },
				]},
				{ group: 'Classification', list: [
					{ name: 'isnan', type: 'function math.isnan(n: number): boolean', tooltip: 'Check if a number is NaN (Not a Number).' },
					{ name: 'isinf', type: 'function math.isinf(n: number): boolean', tooltip: 'Check if a number is infinite.' },
					{ name: 'isfinite', type: 'function math.isfinite(n: number): boolean', tooltip: 'Check if a number is finite.' },
				]},
				{ group: 'Advanced Functions', list: [
					{ name: 'modf', type: 'function math.modf(n: number): (number, number)', tooltip: 'Split the integral and fractional parts of a number.' },
					{ name: 'fmod', type: 'function math.fmod(x: number, y: number): number', tooltip: 'Calculate the floating-point remainder of x divided by y.' },
					{ name: 'frexp', type: 'function math.frexp(n: number): (number, number)', tooltip: 'Decompose a number into a normalized fraction and an integral power of two.' },
					{ name: 'ldexp', type: 'function math.ldexp(s: number, e: number): number', tooltip: 'Multiply a number by 2 raised to the power of an exponent.' },
					{ name: 'exp', type: 'function math.exp(n: number): number', tooltip: 'Calculates e raised to the power of n.' },
					{ name: 'pow', type: 'function math.pow(x: number, y: number): number', tooltip: 'Calculates x raised to the power of y.' },
					{ name: 'log10', type: 'function math.log10(n: number): number', tooltip: 'Calculates the base-10 logarithm of n.' },
					{ name: 'log', type: 'function math.log(n: number, base: number?): number', tooltip: 'Calculates the logarithm of n with the specified base (default is e).' },
				]},
			],
		},
		utf8: {
			constants: [
				{ name: 'charpattern', type: 'string', tooltip: 'A pattern that matches a single UTF-8 character.' },
			],
			functions: [
				{ name: 'offset', type: 'function utf8.offset(s: string, n: number, i: number?): number?', tooltip: 'Returns the byte position in string s where the n-th UTF-8 character starts, counting from position i.' },
				{ name: 'codepoint', type: 'function utf8.codepoint(s: string, i: number?, j: number?): ...number', tooltip: 'Returns the Unicode code points of the UTF-8 characters in string s from position i to j.' },
				{ name: 'char', type: 'function utf8.char(...: number): string', tooltip: 'Returns a UTF-8 string constructed from the given Unicode code points.' },
				{ name: 'len', type: 'function utf8.len(s: string, i: number?, j: number?): number?', tooltip: 'Returns the number of UTF-8 characters in string s from position i to j.' },
				{ name: 'codes', type: 'function utf8.codes(s: string): ((string, number) -> (number, number), string, number)', tooltip: 'Returns an iterator function that iterates over the UTF-8 characters in string s, returning their byte positions and code points.' },
			],
		},
		bit32: {
			functions: [
				{ group: 'Bitwise Operations', list: [
					{ name: 'band', type: 'function bit32.band(args: ...number): number', tooltip: 'Performs a bitwise AND operation on all provided numbers.' },
					{ name: 'bnot', type: 'function bit32.bnot(n: number): number', tooltip: 'Performs a bitwise NOT operation on the given number.' },
					{ name: 'bor', type: 'function bit32.bor(args: ...number): number', tooltip: 'Performs a bitwise OR operation on all provided numbers.' },
					{ name: 'bxor', type: 'function bit32.bxor(args: ...number): number', tooltip: 'Performs a bitwise XOR operation on all provided numbers.' },
					{ name: 'btest', type: 'function bit32.btest(args: ...number): boolean', tooltip: 'Tests if the bitwise AND of all provided numbers is non-zero.' },
				]},
				{ group: 'Bit Field Operations', list: [
					{ name: 'extract', type: 'function bit32.extract(n: number, field: number, width: number?): number', tooltip: 'Extracts a bit field from the given number.' },
					{ name: 'replace', type: 'function bit32.replace(n: number, replacement: number, field: number, width: number?): number', tooltip: 'Replaces a bit field in the given number with the replacement value.' },
					{ name: 'byteswap', type: 'function bit32.byteswap(n: number): number', tooltip: 'Swaps the byte order of the given number.' },
					{ name: 'countlz', type: 'function bit32.countlz(n: number): number', tooltip: 'Counts the number of leading zeros in the binary representation of the given number.' },
					{ name: 'countrz', type: 'function bit32.countrz(n: number): number', tooltip: 'Counts the number of trailing zeros in the binary representation of the given number.' },
				]},
				{ group: 'Bit Rotation and Shifting', list: [
					{ name: 'lrotate', type: 'function bit32.lrotate(n: number, displacement: number): number', tooltip: 'Performs a left bit rotation on the given number by the specified displacement.' },
					{ name: 'rrotate', type: 'function bit32.rrotate(n: number, displacement: number): number', tooltip: 'Performs a right bit rotation on the given number by the specified displacement.' },
					{ name: 'lshift', type: 'function bit32.lshift(n: number, displacement: number): number', tooltip: 'Performs a left bit shift on the given number by the specified displacement.' },
					{ name: 'rshift', type: 'function bit32.rshift(n: number, displacement: number): number', tooltip: 'Performs a right bit shift on the given number by the specified displacement.' },
					{ name: 'arshift', type: 'function bit32.arshift(n: number, displacement: number): number', tooltip: 'Performs an arithmetic right bit shift on the given number by the specified displacement.' },
				]},
			],
		},
		os: {
			functions: [
				{ name: 'clock', type: 'function os.clock(): number', tooltip: 'Returns the amount of CPU time used by the program.' },
				{ name: 'time', type: 'function os.time(time: table?): number?', tooltip: 'Returns the current time as the number of seconds since the epoch, or the time represented by the given table.' },
				{ name: 'date', type: 'function os.date(format: string?, time: number?): table | string | nil', tooltip: 'Returns a formatted date string or a table representing the date and time for the given time value.' },
				{ name: 'difftime', type: 'function os.difftime(a: number, b: number?): number', tooltip: 'Returns the difference in seconds between two time values.' },
			],
		},
		coroutine: {
			functions: [
				{ group: 'Coroutine Creation', list: [
					{ name: 'create', type: 'function coroutine.create(f: function): thread', tooltip: 'Creates a new coroutine with the given function.' },
					{ name: 'wrap', type: 'function coroutine.wrap(f: function): function', tooltip: 'Creates a new coroutine and returns a function that resumes it.' },
				]},
				{ group: 'Coroutine Control', list: [
					{ name: 'resume', type: 'function coroutine.resume(co: thread, args: ...any): (boolean, ...any)', tooltip: 'Resumes the execution of the given coroutine with optional arguments.' },
					{ name: 'close', type: 'function coroutine.close(co: thread): (boolean, any?)', tooltip: 'Closes the given coroutine, releasing its resources.' },
				]},
				{ group: 'Yielding from a Coroutine', list: [
					{ name: 'yield', type: 'function coroutine.yield(args: ...any): ...any', tooltip: 'Yields the execution of the current coroutine, returning optional values to the resumer.' },
				]},
				{ group: 'Coroutine Status and Information', list: [
					{ name: 'isyieldable', type: 'function coroutine.isyieldable(): boolean', tooltip: 'Checks if the current coroutine can yield.' },
					{ name: 'running', type: 'function coroutine.running(): thread?', tooltip: 'Returns the currently running coroutine, or nil if called from the main thread.' },
					{ name: 'status', type: 'function coroutine.status(co: thread): "running" | "suspended" | "normal" | "dead"', tooltip: 'Returns the status of the given coroutine.' },
				]},
			],
		},
		
		// SLua
		ll: {
			functions: Object.entries(lsl.functions).map(([name, func]) => {
				if(func.private) return null;
				if(func.deprecated) return null;
				
				name = name.substring(2);
				
				// Skip removed functions
				if(name in RemovedFunctions) return null;
				
				// Skip duplicate functions
				// if(name in DuplicateFunctions) return null;
				if(name in DuplicateFunctions) func.duplicates = DuplicateFunctions[name];
				
				// Simplify
				delete func['func-id'];
				delete func.energy;
				if('mono-sleep' in func)
				{
					func.sleep = func['mono-sleep'];
					delete func['mono-sleep'];
				}
				if(func.sleep === 0) delete func.sleep;
				if(func.return === 'void') delete func.return;
				
				return {
					name,
					...func,
					arguments: func.arguments.map(arg => {
						const [argumentName, argumentDefinition] = Object.entries(arg).pop();
						return {
							[argumentName]: {
								...argumentDefinition,
								type: convertType(argumentDefinition.type),
							}
						};
					}),
					return: convertType(func.return),
					type: `function ll.${name}(${func.arguments.map(arg => {
						const [argumentName, argumentDefinition] = Object.entries(arg).pop();
						return `${argumentName}: ${convertType(argumentDefinition.type)}`;
					}).join(', ')}): ${convertType(func.return)}`,
				};
			}).filter(Boolean),
		},
		LLEvents: {
			functions: [
				{ name: 'on', type: 'function LLEvents:on(eventName: string, callback: function): function', tooltip: 'Registers a callback function to be called whenever the specified event is emitted.' },
				{ name: 'once', type: 'function LLEvents:once(eventName: string, callback: function): function', tooltip: 'Registers a callback function to be called only the next time the specified event is emitted.' },
				{ name: 'off', type: 'function LLEvents:off(eventName: string, callback: function): boolean', tooltip: 'Unregisters a previously registered callback function for the specified event.' },
				{ name: 'eventNames', type: 'function LLEvents:eventNames(): {string}', tooltip: 'Returns a list of all event names that have registered listeners.' },
				{ name: 'listeners', type: 'function LLEvents:listeners(eventName: string): {[string]: {function}}', tooltip: 'Returns a table of all registered listeners for the specified event name.' },
			],
		},
		LLTimers: {
			functions: [
				{ name: 'every', type: 'function LLTimers:every(seconds: number, callback: (scheduled: number, interval: number)): function', tooltip: 'Schedules a recurring timer that calls the callback function every specified number of seconds.' },
				{ name: 'once', type: 'function LLTimers:once(seconds: number, callback: (scheduled: number)): function', tooltip: 'Schedules a one-time timer that calls the callback function after the specified number of seconds.' },
				{ name: 'off', type: 'function LLTimers:off(handler: function): boolean', tooltip: 'Cancels a previously scheduled timer using its handler function.' },
			],
		},
		lljson: {
			functions: [
				{ group: 'JSON', list: [
					{ name: 'encode', type: 'function lljson.encode(data: any): string', tooltip: 'Encodes a Lua value into a JSON string.' },
					{ name: 'decode', type: 'function lljson.decode(json: string): any', tooltip: 'Decodes a JSON string into a Lua value.' },
				]},
				{ group: 'Second Life specific (also handles vectors, quaternions, buffers and UUIDs etc)', list: [
					{ name: 'slencode', type: 'function lljson.slencode(data: any, tightEncoding: boolean?): string', tooltip: 'Encodes a Lua value into an SL-JSON string. If tightEncoding is true, uses a more compact representation.' },
					{ name: 'sldecode', type: 'function lljson.sldecode(json: string): any', tooltip: 'Decodes an SL-JSON string into a Lua value.' },
				]},
			],
		},
		llbase64: {
			functions: [
				{ name: 'encode', type: 'function llbase64.encode(data: string | buffer): string', tooltip: 'Encodes a string or buffer into a Base64 encoded string.' },
				{ name: 'decode', type: 'function llbase64.decode(data: string, asBuffer: boolean?): string | buffer', tooltip: 'Decodes a Base64 encoded string into a string or buffer. If asBuffer is true, returns a buffer.' },
			],
		},
		llcompat: {
			functions: Object.entries(lsl.functions).map(([name, func]) => {
				if(func.private) return null;
				if(func.deprecated) return null;
				
				name = name.substring(2);
				
				// Simplify
				delete func['func-id'];
				delete func.energy;
				if('mono-sleep' in func)
				{
					func.sleep = func['mono-sleep'];
					delete func['mono-sleep'];
				}
				if(func.sleep === 0) delete func.sleep;
				if(func.return === 'void') delete func.return;
				
				return {
					name,
					...func,
					arguments: func.arguments.map(arg => {
						const [argumentName, argumentDefinition] = Object.entries(arg).pop();
						return {
							[argumentName]: {
								...argumentDefinition,
								type: convertType(argumentDefinition.type),
							}
						};
					}),
					return: convertType(func.return),
					type: `function ll.${name}(${func.arguments.map(arg => {
						const [argumentName, argumentDefinition] = Object.entries(arg).pop();
						return `${argumentName}: ${convertType(argumentDefinition.type)}`;
					}).join(', ')})${func.return ? `: ${convertType(func.return)}` : ''}`,
				};
			}).filter(Boolean),
		},
	},
	constants: Object.fromEntries(
		Object.entries(lsl.constants).map(([name, constant]) => {
			const type = convertType(constant.type, constant.value);
			return [name, { ...constant, type }];
		})
	),
	events: {
		touch_start: {
			arguments: {
				events: { type: '{DetectedEvent}' },
			},
		},
		touch: {
			arguments: {
				events: { type: '{DetectedEvent}' },
			},
		},
		touch_end: {
			arguments: {
				events: { type: '{DetectedEvent}' },
			},
		},
		
		control: {
			arguments: {
				avatar: { type: 'uuid' },
				levels: { type: 'number' },
				edges: { type: 'number' }
			},
		},
		game_control: {
			arguments: {
				avatar: { type: 'uuid' },
				buttons: { type: 'number', },
				axes: { type: '{number, number, number, number, number, number}' },
			},
		},
		
		run_time_permissions: {
			arguments: {
				permissionFlags: { type: 'number' }
			},
		},
		experience_permissions: {
			arguments: {
				agent_id: { type: 'uuid' }
			},
		},
		experience_permissions_denied: {
			arguments: {
				agent_id: { type: 'uuid' },
				reason: { type: 'number' }
			},
		},
		on_damage: {
			arguments: {
				events: { type: '{DetectedEvent}' }
			},
		},
		final_damage: {
			arguments: {
				events: { type: '{DetectedEvent}' }
			},
		},
		on_death: {},
		
		attach: {
			arguments: {
				avatar: { type: 'uuid' }
			},
		},
		on_rez: {
			arguments: {
				startParameter: { type: 'number' }
			},
		},
		object_rez: {
			arguments: {
				rezzedObject: { type: 'uuid' }
			},
		},
		
		changed: {
			arguments: {
				changed: { type: 'number' }
			},
		},
		
		dataserver: {
			arguments: {
				request: { type: 'uuid' },
				data: { type: 'string' }
			},
		},
		email: {
			arguments: {
				time: { type: 'string' },
				address: { type: 'string' },
				subject: { type: 'string' },
				body: { type: 'string' },
				remaining: { type: 'number' }
			},
		},
		http_request: {
			arguments: {
				request: { type: 'uuid' },
				method: { type: 'string' },
				body: { type: 'string' }
			},
		},
		http_response: {
			arguments: {
				request: { type: 'uuid' },
				status: { type: 'number' },
				metadata: { type: 'table' },
				body: { type: 'string' }
			},
		},
		listen: {
			arguments: {
				channel: { type: 'number' },
				name: { type: 'string' },
				id: { type: 'uuid' },
				message: { type: 'string' }
			},
		},
		
		link_message: {
			arguments: {
				link: { type: 'number' },
				value: { type: 'number' },
				text: { type: 'string' },
				identifier: { type: 'uuid | string' }
			},
		},
		linkset_data: {
			arguments: {
				action: { type: 'number' },
				name: { type: 'string' },
				value: { type: 'string' }
			},
		},
		
		sensor: {
			arguments: {
				events: { type: '{DetectedEvent}' }
			},
		},
		no_sensor: {},
		
		at_target: {
			arguments: {
				target: { type: 'number' },
				targetPosition: { type: 'vector' },
				currentPosition: { type: 'vector' }
			},
		},
		not_at_target: {},
		
		at_rot_target: {
			arguments: {
				target: { type: 'number' },
				targetRotation: { type: 'quaternion' },
				currentRotation: { type: 'quaternion' }
			},
		},
		not_at_rot_target: {},
		
		collision_start: {
			arguments: {
				events:	{ type: '{DetectedEvent}' }
			},
		},
		collision: {
			arguments: {
				events: { type: '{DetectedEvent}' }
			},
		},
		collision_end: {
			arguments: {
				events: { type: '{DetectedEvent}' }
			},
		},
		land_collision_start: {
			arguments: {
				position: { type: 'vector' }
			},
		},
		land_collision: {
			arguments: {
				position: { type: 'vector' }
			},
		},
		land_collision_end: {
			arguments: {
				position: { type: 'vector' }
			},
		},
		
		moving_end: {},
		moving_start: {},
		
		path_update: {
			arguments: {
				type: { type: 'number' },
				reserved: { type: 'table' }
			},
		},
		
		money: {
			arguments: {
				payer: { type: 'uuid' },
				amount: { type: 'number' }
			},
		},
		transaction_result: {
			arguments: {
				request: { type: 'uuid' },
				success: { type: 'number' },
				message: { type: 'string' }
			},
		},
	},
};

// Let LSL events through as a fallback
for(const [lslEventName, lslEventDef] of Object.entries(lsl.events)) {
	if(lslEventDef.private) continue;
	if(lslEventDef.deprecated) continue;
	if(['state_entry', 'state_exit', 'timer'].includes(lslEventName)) continue; // handled natively
	
	if(!(lslEventName in slua.events)) {
		console.log(`Adding fallback LSL event definition for ${lslEventName}`);
		slua.events[lslEventName] = {
			...lslEventDef,
			arguments: lslEventDef?.arguments?.map(arg => {
				const [argumentName, argumentDefinition] = Object.entries(arg).pop();
				return {
					[argumentName]: {
						...argumentDefinition,
						type: convertType(argumentDefinition.type),
					}
				};
			}),
		};
	}
	else
	{
		// Merge tooltip if missing
		if(!slua.events[lslEventName].tooltip && lslEventDef.tooltip) {
			console.log(`Adding tooltip to SLua event definition for ${lslEventName}`);
			slua.events[lslEventName].tooltip = lslEventDef.tooltip;
		}
		
		// Merge argument tooltips if missing
		if(lslEventDef.arguments) {
			for(const argDef of lslEventDef.arguments) {
				const [argumentName, argumentDefinition] = Object.entries(argDef).pop();
				const sluaEventArg = slua.events[lslEventName].arguments?.[argumentName];
				if(sluaEventArg && !sluaEventArg.tooltip && argumentDefinition.tooltip) {
					console.log(`Adding tooltip to SLua event argument definition for ${lslEventName}.${argumentName}`);
					slua.events[lslEventName].arguments[argumentName].tooltip = argumentDefinition.tooltip;
				}
			}
		}
	}
}

// Loop through and mark fastcall functions
for(const funcName of Fastcalls)
{
	if(funcName.includes('.')) {
		const [libName, shortFuncName] = funcName.split('.');
		const library = slua.libraries[libName];
		if(!library) continue;
		if(library?.functions?.[shortFuncName]) {
			slua.libraries[libName].functions[shortFuncName].fastcall = true;
		}
	} else if(slua.libraries.global.functions[funcName]) {
		slua.libraries.global.functions[funcName].fastcall = true;
	}
}


writeFile(sluaDefinitionsPath, dump(slua));
