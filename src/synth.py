import sys
import ast
import json
import core

reserved_names = ["time", "#", "$", "lineno", "prev_lineno", "next_lineno", "__run_py__"]

patterns = ["# = #.split(',')",
			"# = #.split(';')",
			"# = #.strip()",
			"# = [tmp.strip() for tmp in #.split(',')]",
			"# = [tmp.strip() for tmp in #.split(';')]",
			"# = re.split('(?:\s*;\s*)|(?:\s*,\s*)',#)[:-1]",
			"# = re.split('(?:\s*;\s*)|(?:\s*,\s*)',#)"]

#patterns = ["# = #.split(',')", "# = #.split(';')"]

def reserved_name(n):
	for reserved in reserved_names:
		if (n == reserved):
			return True
	return False

class VarCollector(ast.NodeVisitor):

	def __init__(self):
		ast.NodeVisitor()
		self.vars = set()

	def visit_Name(self, node):
		if (node.id != core.magic_var_name):
			print("Name " + node.id + " @ line " + str(node.lineno) + " col " + str(node.col_offset))
			self.vars.add(node.id)

	def visit_arg(self, node):
		print("arg " + node.arg + " @ line " + str(node.lineno) + " col " + str(node.col_offset))
		self.vars.add(node.arg)

def compute_list_of_vars(code):
	root = ast.parse(code)
	#print(ast.dump(root))
	var_collector = VarCollector()
	var_collector.visit(root)
	return var_collector.vars

def run_stmt(setup, stmt):
	locals = {}
	globals = {}
	try:
		exec(setup + stmt, globals, locals)
	except:
		pass
	return locals

def expand_pattern(pattern, vars, result_stmts):
	if (not "#" in pattern):
		result_stmts.append(pattern)
	else:
		for v in vars:
			expand_pattern(pattern.replace("#", v, 1), vars, result_stmts)

def expand_all_patterns(vars):
	result_stmts = []
	for pattern in patterns:
		expand_pattern(pattern, vars, result_stmts)
	return result_stmts

def compute_setup(before):
	setup = ""
	for v in before.keys():
		if (not reserved_name(v)):
			setup = setup + v + "=" + before[v] + "\n"
	return "import re\n" + setup

def results_eq(goal, actual):
	for v in goal.keys():
		if (not reserved_name(v)):
			if (not v in actual):
				return False
			if (not goal[v] == actual[v]):
				return False
	return True

def try_all_stmts(stmts, before, after):
	setup = compute_setup(before)
	for stmt in stmts:
		actual = run_stmt(setup, stmt)
		if (results_eq(after, actual)):
			return stmt
	return None

def load_code(filename):
	lines = core.load_code_lines(filename)
	code = "".join(lines)
	print(code)
	return code

def load_example(filename):
	with open(filename) as f:
		json_examples = f.read()
	examples = json.loads(json_examples)
	before = examples[0]
	after = examples[1]
	for v in after.keys():
		if (not reserved_name(v)):
			after[v] = eval(after[v])
	print("Before: ")
	print(before)
	print("After: ")
	print(after)
	return (before, after)

def write_output(synthesized):
	if synthesized == None:
		synthesized = "None"
	with open(sys.argv[1] + ".out", "w") as out:
		out.write(synthesized)

def main():

	if len(sys.argv) != 3:
		print("Usage: run <example-file-name> <code-file-name>")
		exit(-1)

	code = load_code(sys.argv[2])
	(before, after) = load_example(sys.argv[1])
	vars = compute_list_of_vars(code)
	stmts = expand_all_patterns(vars)
	synthesized = try_all_stmts(stmts, before, after)
	write_output(synthesized)

main()
